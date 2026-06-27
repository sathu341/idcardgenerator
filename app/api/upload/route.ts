import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { connectDB } from '@/lib/mongodb';
import { Card } from '@/models/Card';

/** Normalise a column key to snake_case alphanumeric */
const normalizeKey = (key: string) =>
  key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Parse a PDF buffer and extract a table from its text.
 *  Strategy: extract text line-by-line, treat the first non-empty line block
 *  as headers, subsequent blocks as rows (tab- or multiple-space-delimited). */
async function parsePDF(buffer: ArrayBuffer): Promise<Record<string, string>[]> {
  // Use pdf-parse (server-side only)
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(Buffer.from(buffer));

  const lines = data.text
    .split('\n')
    .map((l: string) => l.trim())
    .filter((l: string) => l.length > 0);

  if (lines.length < 2) {
    throw new Error('Could not extract table data from PDF. Make sure the PDF contains a text-based table.');
  }

  // Detect delimiter: tab preferred, else 2+ consecutive spaces
  const detectDelimiter = (line: string): RegExp => {
    if (line.includes('\t')) return /\t/;
    return /\s{2,}/;
  };

  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0].split(delimiter).map((h: string) => h.trim()).filter(Boolean);

  if (headers.length < 2) {
    // Try splitting every whitespace run as fallback (common in simple PDFs)
    const fallbackHeaders = lines[0].split(/\s+/).filter(Boolean);
    if (fallbackHeaders.length < 2) {
      throw new Error('Could not detect column headers in PDF. Use a spreadsheet with clear column headers.');
    }
    // Re-process with single-space split
    return lines.slice(1).map((line: string) => {
      const cells = line.split(/\s+/).filter(Boolean);
      const row: Record<string, string> = {};
      fallbackHeaders.forEach((h: string, i: number) => { row[h] = cells[i] ?? ''; });
      return row;
    }).filter((row: Record<string, string>) => Object.values(row).some((v) => v !== ''));
  }

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(delimiter).map((c: string) => c.trim());
    if (cells.length === 0 || (cells.length === 1 && cells[0] === '')) continue;
    const row: Record<string, string> = {};
    headers.forEach((h: string, idx: number) => { row[h] = cells[idx] ?? ''; });
    rows.push(row);
  }

  return rows;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const fileName = file.name.toLowerCase();
    let rawData: Record<string, unknown>[];

    if (fileName.endsWith('.pdf')) {
      // --- PDF parsing path ---
      const pdfRows = await parsePDF(buffer);
      rawData = pdfRows as Record<string, unknown>[];
    } else {
      // --- Excel / CSV path ---
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      rawData = XLSX.utils.sheet_to_json(worksheet, { raw: false }) as Record<string, unknown>[];
    }

    if (rawData.length === 0) {
      return NextResponse.json({ error: 'No data rows found in the file.' }, { status: 400 });
    }

    const rows = rawData.map((row, index) => {
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        normalized[normalizeKey(k)] = String(v ?? '');
      }
      return { rowIndex: index, originalData: row, normalizedData: normalized };
    });

    const originalKeys = Object.keys(rawData[0]);
    const columns = originalKeys.map((k) => ({
      original: k,
      normalized: normalizeKey(k),
      isPhoto:
        k.toLowerCase().includes('photo') ||
        k.toLowerCase().includes('image') ||
        k.toLowerCase().includes('pic'),
    }));

    await connectDB();
    await Card.deleteMany({});
    const cards = rows.map((r) => ({
      rowIndex: r.rowIndex,
      data: r.normalizedData,
      templateId: '',
    }));
    await Card.insertMany(cards);

    return NextResponse.json({
      success: true,
      totalRows: rows.length,
      columns,
      preview: rows.slice(0, 3).map((r) => r.normalizedData),
    });
  } catch (error: any) {
     console.error("UPLOAD ERROR:");
  console.error(error);
  console.error(error.stack);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    await connectDB();
    const cards = await Card.find({}).sort({ rowIndex: 1 }).lean();
    return NextResponse.json({ cards });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
