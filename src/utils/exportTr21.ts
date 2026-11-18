import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Capacitor } from '@capacitor/core';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  VerticalMergeType,
  WidthType,
  type IBorderOptions,
  type ITableCellBorders,
  type TableVerticalAlign,
} from 'docx';
import { BillForm } from '../components/BillForm';
import type { Tr21FormData } from '../lib/billFormData';
import { ensureBengaliFontsLoaded } from './exportPdf';
import { saveAndShareFile, type SaveAndShareOutcome } from './saveFile';

function waitAnimationFrames(count = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (rem: number) => {
      if (rem <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(rem - 1));
    };
    step(count);
  });
}

function buildFileBase(billNoOrId: string): string {
  const clean = (billNoOrId || 'bill')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `bill-${clean || 'tr21'}`;
}

/**
 * Generates an A4 Portrait 2-page (or multi-page for long item lists) PDF matching
 * T.R. Form No. 21 using the bundled Nikosh / Noto Sans Bengali font.
 */
export async function exportTr21Pdf(
  data: Tr21FormData,
  billNoForFile: string
): Promise<SaveAndShareOutcome> {
  await ensureBengaliFontsLoaded();

  const host = document.createElement('div');
  host.style.cssText = [
    'position: fixed',
    'left: -10000px',
    'top: 0',
    'width: 794px',
    'background: #ffffff',
    'color: #000000',
    'z-index: -1',
    'pointer-events: none',
  ].join(';');
  document.body.appendChild(host);

  try {
    host.innerHTML = renderToStaticMarkup(React.createElement(BillForm, { data }));
    await waitAnimationFrames(2);

    const pageNodes = Array.from(host.querySelectorAll('.tr21-page')) as HTMLElement[];
    const targets = pageNodes.length > 0 ? pageNodes : [host];

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const pageWidthMm = pdf.internal.pageSize.getWidth(); // 210
    const pageHeightMm = pdf.internal.pageSize.getHeight(); // 297
    let isFirstPdfPage = true;

    for (const node of targets) {
      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });

      const fullHeightMm = (canvas.height * pageWidthMm) / canvas.width;

      if (fullHeightMm <= pageHeightMm + 1) {
        if (!isFirstPdfPage) {
          pdf.addPage('a4', 'portrait');
        }
        isFirstPdfPage = false;
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        pdf.addImage(
          imgData,
          'JPEG',
          0,
          0,
          pageWidthMm,
          Math.min(fullHeightMm, pageHeightMm),
          undefined,
          'FAST'
        );
      } else {
        // Long item list overflow: slice cleanly across multiple portrait A4 pages
        const sliceHeightPx = Math.floor((pageHeightMm / pageWidthMm) * canvas.width);
        let offsetY = 0;
        while (offsetY < canvas.height) {
          const chunkH = Math.min(sliceHeightPx, canvas.height - offsetY);
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = chunkH;
          const ctx = sliceCanvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
            ctx.drawImage(canvas, 0, offsetY, canvas.width, chunkH, 0, 0, canvas.width, chunkH);
          }
          if (!isFirstPdfPage) {
            pdf.addPage('a4', 'portrait');
          }
          isFirstPdfPage = false;
          const sliceMm = (chunkH * pageWidthMm) / canvas.width;
          pdf.addImage(
            sliceCanvas.toDataURL('image/jpeg', 0.95),
            'JPEG',
            0,
            0,
            pageWidthMm,
            sliceMm,
            undefined,
            'FAST'
          );
          sliceCanvas.width = 0;
          sliceCanvas.height = 0;
          offsetY += chunkH;
        }
      }

      canvas.width = 0;
      canvas.height = 0;
    }

    const buffer = pdf.output('arraybuffer');
    return saveAndShareFile({
      data: new Uint8Array(buffer),
      fileName: `${buildFileBase(billNoForFile)}.pdf`,
      mimeType: 'application/pdf',
      title: `টি.আর. ফরম নং-২১ (${billNoForFile})`,
    });
  } finally {
    host.remove();
  }
}

let activePrintCleanup: (() => void) | null = null;

/**
 * Prints T.R. Form No. 21 in A4 Portrait on web (hiding the app shell),
 * or shares the rendered PDF on Capacitor Android where window.print() is unsupported.
 */
export async function printTr21Form(
  data: Tr21FormData,
  billNoForFile: string
): Promise<SaveAndShareOutcome | { status: 'printed' }> {
  if (Capacitor.isNativePlatform()) {
    return exportTr21Pdf(data, billNoForFile);
  }

  await ensureBengaliFontsLoaded();

  if (activePrintCleanup) {
    activePrintCleanup();
  }

  let printHost = document.getElementById('tr21-print-root');
  if (!printHost) {
    printHost = document.createElement('div');
    printHost.id = 'tr21-print-root';
    document.body.appendChild(printHost);
  }

  printHost.innerHTML = renderToStaticMarkup(React.createElement(BillForm, { data }));
  await waitAnimationFrames(2);

  document.body.classList.add('tr21-printing');

  let cleanedUp = false;
  let timerId: number | undefined;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (activePrintCleanup === cleanup) {
      activePrintCleanup = null;
    }
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
    }
    document.body.classList.remove('tr21-printing');
    window.removeEventListener('afterprint', cleanup);
    const el = document.getElementById('tr21-print-root');
    if (el) {
      el.innerHTML = '';
    }
  };

  activePrintCleanup = cleanup;
  window.addEventListener('afterprint', cleanup);
  timerId = window.setTimeout(cleanup, 60000);

  window.print();
  return { status: 'printed' };
}

/* ============================================================================
 * Editable Word (.docx) Export — structured around Tr21FormData
 * ============================================================================ */

const FONT_BN = 'NikoshBAN';
const CELL_BORDER: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
const NO_BORDER: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const ALL_BORDERS: ITableCellBorders = {
  top: CELL_BORDER,
  bottom: CELL_BORDER,
  left: CELL_BORDER,
  right: CELL_BORDER,
};
const NO_BORDERS: ITableCellBorders = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
};

function bnRun(
  text: string,
  opts?: { bold?: boolean; size?: number; underline?: boolean; color?: string }
): TextRun {
  return new TextRun({
    text,
    font: {
      name: FONT_BN,
      ascii: FONT_BN,
      hAnsi: FONT_BN,
      cs: FONT_BN,
      eastAsia: FONT_BN,
    },
    size: opts?.size ?? 20, // half-points (20 = 10pt)
    bold: opts?.bold,
    color: opts?.color ?? '000000',
    underline: opts?.underline ? { type: UnderlineType.SINGLE } : undefined,
  });
}

function bnPara(
  text: string,
  opts?: {
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    bold?: boolean;
    size?: number;
    color?: string;
    spaceBefore?: number;
    spaceAfter?: number;
    indentLeft?: number;
  }
): Paragraph {
  return new Paragraph({
    alignment: opts?.align ?? AlignmentType.LEFT,
    spacing: {
      before: opts?.spaceBefore ?? 0,
      after: opts?.spaceAfter ?? 40,
      line: 260,
    },
    indent: opts?.indentLeft ? { left: opts.indentLeft } : undefined,
    children: [bnRun(text, { bold: opts?.bold, size: opts?.size, color: opts?.color })],
  });
}

function borderedCell(
  children: Paragraph[],
  opts?: {
    width?: number;
    columnSpan?: number;
    verticalMerge?: (typeof VerticalMergeType)[keyof typeof VerticalMergeType];
    vAlign?: TableVerticalAlign;
    borders?: Partial<ITableCellBorders>;
    margins?: { top?: number; bottom?: number; left?: number; right?: number };
  }
): TableCell {
  return new TableCell({
    width: opts?.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    columnSpan: opts?.columnSpan,
    verticalMerge: opts?.verticalMerge,
    verticalAlign: opts?.vAlign ?? VerticalAlign.TOP,
    borders: { ...ALL_BORDERS, ...(opts?.borders || {}) },
    margins: {
      top: opts?.margins?.top ?? 55,
      bottom: opts?.margins?.bottom ?? 55,
      left: opts?.margins?.left ?? 85,
      right: opts?.margins?.right ?? 85,
    },
    children,
  });
}

function plainCell(children: Paragraph[], width?: number): TableCell {
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    borders: NO_BORDERS,
    margins: { top: 20, bottom: 20, left: 20, right: 20 },
    children,
  });
}

export async function exportTr21Docx(
  data: Tr21FormData,
  billNoForFile: string
): Promise<SaveAndShareOutcome> {
  const docChildren: Array<Paragraph | Table> = [];

  if (data.isDraft) {
    docChildren.push(
      bnPara('[খসড়া / DRAFT — অননুমোদিত খসড়া বিল]', {
        align: AlignmentType.CENTER,
        bold: true,
        size: 20,
        color: '991B1B',
        spaceAfter: 60,
      })
    );
  }

  // [P1-S1] Page 1 Header Table (Top-left form number | Center Title & Office)
  docChildren.push(
    new Table({
      width: { size: 10700, type: WidthType.DXA },
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            plainCell(
              [
                bnPara('টি.আর.ফরম নং-২১', { size: 17, spaceAfter: 10 }),
                bnPara('(এস.আর ১৮৩ দ্রষ্টব্য)', { size: 17, spaceAfter: 0 }),
              ],
              2200
            ),
            plainCell(
              [
                bnPara('ক্রয়, সরবরাহ ও সেবা বাবদ ব্যয়ের বিল', {
                  align: AlignmentType.CENTER,
                  bold: true,
                  size: 28,
                  spaceAfter: 30,
                }),
                bnPara(`দপ্তর ঃ ${data.officeName}`, {
                  align: AlignmentType.CENTER,
                  size: 22,
                  spaceAfter: 0,
                }),
              ],
              6500
            ),
            plainCell([bnPara('', { size: 17 })], 2000),
          ],
        }),
      ],
    })
  );

  // [P1-S2] Institutional Code 13 Boxes + Token + Date row
  const codeCells: TableCell[] = [
    plainCell([bnPara('প্রাতিষ্ঠানিক / অপারেশন কোড *', { size: 19, spaceAfter: 0 })], 2850),
    ...data.institutionalCodeBoxes.map((digit) =>
      borderedCell([bnPara(digit, { align: AlignmentType.CENTER, bold: true, size: 20, spaceAfter: 0 })], {
        width: 315,
        vAlign: VerticalAlign.CENTER,
        margins: { top: 30, bottom: 30, left: 20, right: 20 },
      })
    ),
    plainCell(
      [
        bnPara(data.tokenNoBn ? `টোকেন নং ${data.tokenNoBn}` : 'টোকেন নং', {
          align: AlignmentType.CENTER,
          size: 19,
          spaceAfter: 0,
        }),
      ],
      2200
    ),
    plainCell([bnPara('তারিখ', { align: AlignmentType.RIGHT, size: 19, spaceAfter: 0 })], 1555),
  ];

  docChildren.push(
    new Table({
      width: { size: 10700, type: WidthType.DXA },
      borders: NO_BORDERS,
      rows: [new TableRow({ children: codeCells })],
    })
  );

  // Voucher No & Bill Date row
  docChildren.push(
    new Table({
      width: { size: 10700, type: WidthType.DXA },
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            plainCell(
              [
                bnPara(
                  `ভাউচার নং - ${data.voucherNoBn || '...........'}   (${data.fyShortBn})`,
                  { size: 20, spaceAfter: 40 }
                ),
              ],
              6200
            ),
            plainCell(
              [
                bnPara(`তারিখ - ${data.billDateShortBn}`, {
                  align: AlignmentType.RIGHT,
                  size: 20,
                  spaceAfter: 40,
                }),
              ],
              4500
            ),
          ],
        }),
      ],
    })
  );

  // [P1-S3] Main Table Part 1 (অর্থনৈতিক কোড | বিবরণ | টাকার পরিমাণ | পয়সা + মোট টাকা ক)
  const C1 = 1700;
  const C2 = 6200;
  const C3 = 1900;
  const C4 = 900;

  const supplierParts: string[] = [];
  if (data.supplier?.name?.trim()) supplierParts.push(`সরবরাহকারী: ${data.supplier.name.trim()}`);
  if (data.supplier?.address?.trim()) supplierParts.push(`ঠিকানা: ${data.supplier.address.trim()}`);
  if (data.supplier?.tinBin?.trim()) supplierParts.push(`টিআইএন/বিআইএন: ${data.supplier.tinBin.trim()}`);

  const introParagraphs: Paragraph[] = [
    bnPara(data.introText, { align: AlignmentType.BOTH, size: 20, spaceAfter: 40 }),
  ];
  if (supplierParts.length > 0) {
    introParagraphs.push(bnPara(supplierParts.join(' · '), { size: 19, spaceAfter: 40 }));
  }

  const mainRows: TableRow[] = [
    // Table Header
    new TableRow({
      tableHeader: true,
      children: [
        borderedCell([bnPara('অর্থনৈতিক কোড', { align: AlignmentType.CENTER, bold: true, size: 20, spaceAfter: 0 })], { width: C1 }),
        borderedCell([bnPara('বিবরণ', { align: AlignmentType.CENTER, bold: true, size: 20, spaceAfter: 0 })], { width: C2 }),
        borderedCell([bnPara('টাকার পরিমাণ', { align: AlignmentType.CENTER, bold: true, size: 20, spaceAfter: 0 })], { width: C3 }),
        borderedCell([bnPara('পয়সা', { align: AlignmentType.CENTER, bold: true, size: 20, spaceAfter: 0 })], { width: C4 }),
      ],
    }),
    // Intro Row
    new TableRow({
      children: [
        borderedCell([bnPara(data.economicCodeBn, { align: AlignmentType.CENTER, size: 21, spaceAfter: 0 })], {
          width: C1,
          verticalMerge: VerticalMergeType.RESTART,
          vAlign: VerticalAlign.CENTER,
        }),
        borderedCell(introParagraphs, {
          width: C2,
          borders: { bottom: NO_BORDER },
        }),
        borderedCell([bnPara('', { spaceAfter: 0 })], {
          width: C3,
          borders: { bottom: NO_BORDER },
        }),
        borderedCell([bnPara('', { spaceAfter: 0 })], {
          width: C4,
          borders: { bottom: NO_BORDER },
        }),
      ],
    }),
  ];

  // Item Rows
  const itemsToRender = data.items.length > 0 ? data.items : [];
  if (itemsToRender.length === 0) {
    mainRows.push(
      new TableRow({
        children: [
          borderedCell([bnPara('', { spaceAfter: 0 })], {
            width: C1,
            verticalMerge: VerticalMergeType.CONTINUE,
          }),
          borderedCell([bnPara(' ', { spaceAfter: 0 })], {
            width: C2,
            borders: { top: NO_BORDER },
          }),
          borderedCell([bnPara(data.gross.takaStr, { align: AlignmentType.RIGHT, spaceAfter: 0 })], {
            width: C3,
            borders: { top: NO_BORDER },
          }),
          borderedCell([bnPara(data.gross.paisaStr, { align: AlignmentType.CENTER, spaceAfter: 0 })], {
            width: C4,
            borders: { top: NO_BORDER },
          }),
        ],
      })
    );
  } else {
    itemsToRender.forEach((it, idx) => {
      const isLast = idx === itemsToRender.length - 1;
      mainRows.push(
        new TableRow({
          children: [
            borderedCell([bnPara('', { spaceAfter: 0 })], {
              width: C1,
              verticalMerge: VerticalMergeType.CONTINUE,
            }),
            borderedCell(
              [
                bnPara(`${it.indexBn}) ${it.description}`, {
                  size: 20,
                  indentLeft: 160,
                  spaceAfter: isLast ? 60 : 20,
                }),
              ],
              {
                width: C2,
                borders: { top: NO_BORDER, bottom: isLast ? CELL_BORDER : NO_BORDER },
              }
            ),
            borderedCell([bnPara(it.takaStr, { align: AlignmentType.RIGHT, size: 20, spaceAfter: 0 })], {
              width: C3,
              vAlign: VerticalAlign.BOTTOM,
              borders: { top: NO_BORDER, bottom: isLast ? CELL_BORDER : NO_BORDER },
            }),
            borderedCell([bnPara(it.paisaStr, { align: AlignmentType.CENTER, size: 20, spaceAfter: 0 })], {
              width: C4,
              vAlign: VerticalAlign.BOTTOM,
              borders: { top: NO_BORDER, bottom: isLast ? CELL_BORDER : NO_BORDER },
            }),
          ],
        })
      );
    });
  }

  // Gross Total Row
  mainRows.push(
    new TableRow({
      children: [
        borderedCell([bnPara('', { spaceAfter: 0 })], { width: C1 }),
        borderedCell([bnPara('মোট টাকা (ক)', { align: AlignmentType.RIGHT, bold: true, size: 20, spaceAfter: 0 })], { width: C2 }),
        borderedCell([bnPara(data.gross.takaStr, { align: AlignmentType.RIGHT, bold: true, size: 20, spaceAfter: 0 })], { width: C3 }),
        borderedCell([bnPara(data.gross.paisaStr, { align: AlignmentType.CENTER, bold: true, size: 20, spaceAfter: 0 })], { width: C4 }),
      ],
    }),
    // [P1-S4] Deductions Sub-header, Lines, Total Deduction & Net Payable
    new TableRow({
      children: [
        borderedCell([bnPara('কর্তন ও পরিশোধ', { bold: true, size: 20, spaceAfter: 0 })], {
          width: 10700,
          columnSpan: 4,
        }),
      ],
    })
  );

  // Deduction Rows
  data.deductions.forEach((d) => {
    mainRows.push(
      new TableRow({
        children: [
          borderedCell([bnPara(d.codeBn, { size: 20, spaceAfter: 0 })], { width: C1 }),
          borderedCell([bnPara(d.label, { size: 20, spaceAfter: 0 })], { width: C2 }),
          borderedCell([bnPara(d.takaStr, { align: AlignmentType.RIGHT, size: 20, spaceAfter: 0 })], { width: C3 }),
          borderedCell([bnPara(d.paisaStr, { align: AlignmentType.CENTER, size: 20, spaceAfter: 0 })], { width: C4 }),
        ],
      })
    );
  });

  // 2 Blank Rows
  for (let i = 0; i < data.blankDeductionRowsCount; i++) {
    mainRows.push(
      new TableRow({
        children: [
          borderedCell([bnPara(' ', { size: 18, spaceAfter: 0 })], { width: C1 }),
          borderedCell([bnPara(' ', { size: 18, spaceAfter: 0 })], { width: C2 }),
          borderedCell([bnPara(' ', { size: 18, spaceAfter: 0 })], { width: C3 }),
          borderedCell([bnPara(' ', { size: 18, spaceAfter: 0 })], { width: C4 }),
        ],
      })
    );
  }

  // Total Deduction + Net Payable + Words
  mainRows.push(
    new TableRow({
      children: [
        borderedCell([bnPara('', { spaceAfter: 0 })], { width: C1 }),
        borderedCell(
          [
            bnPara('কর্তন ও পরিশোধ বাবদ মোট আদায় (খ)', {
              align: AlignmentType.RIGHT,
              bold: true,
              size: 20,
              spaceAfter: 0,
            }),
          ],
          { width: C2 }
        ),
        borderedCell(
          [bnPara(data.totalDeduction.takaStr, { align: AlignmentType.RIGHT, bold: true, size: 20, spaceAfter: 0 })],
          { width: C3 }
        ),
        borderedCell(
          [bnPara(data.totalDeduction.paisaStr, { align: AlignmentType.CENTER, bold: true, size: 20, spaceAfter: 0 })],
          { width: C4 }
        ),
      ],
    }),
    new TableRow({
      children: [
        borderedCell([bnPara(data.netPayableCodeBn, { bold: true, size: 20, spaceAfter: 0 })], { width: C1 }),
        borderedCell([bnPara('প্রদেয় বিল (ক-খ)', { bold: true, size: 20, spaceAfter: 0 })], { width: C2 }),
        borderedCell(
          [bnPara(data.netPayable.takaStr, { align: AlignmentType.RIGHT, bold: true, size: 20, spaceAfter: 0 })],
          { width: C3 }
        ),
        borderedCell(
          [bnPara(data.netPayable.paisaStr, { align: AlignmentType.CENTER, bold: true, size: 20, spaceAfter: 0 })],
          { width: C4 }
        ),
      ],
    }),
    new TableRow({
      children: [
        borderedCell([bnPara(`টাকা (কথায়): ${data.netPayableInWords}।`, { size: 20, spaceAfter: 0 })], {
          width: 10700,
          columnSpan: 4,
        }),
      ],
    })
  );

  docChildren.push(
    new Table({
      width: { size: 10700, type: WidthType.DXA },
      rows: mainRows,
    })
  );

  // [P1-S5] Page 1 Clauses (1 to 10)
  docChildren.push(bnPara('', { size: 12, spaceAfter: 40 }));
  for (const clause of data.page1Clauses) {
    const lines = clause.text.split('\n');
    lines.forEach((line, idx) => {
      const prefix = idx === 0 ? `${clause.numberBn}. ` : '';
      const isSub = /^\([ক-ঙ]\)/.test(line.trim());
      docChildren.push(
        bnPara(`${prefix}${line}`, {
          align: AlignmentType.BOTH,
          size: 18,
          indentLeft: isSub ? 360 : idx > 0 ? 180 : 0,
          spaceAfter: idx === lines.length - 1 ? 35 : 15,
        })
      );
    });
  }

  // Page Break -> Page 2
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  if (data.isDraft) {
    docChildren.push(
      bnPara('[খসড়া / DRAFT — অননুমোদিত খসড়া বিল]', {
        align: AlignmentType.CENTER,
        bold: true,
        size: 20,
        color: '991B1B',
        spaceAfter: 60,
      })
    );
  }

  // [P2-S1] Page 2 Clauses (11 and 12)
  for (const clause of data.page2Clauses) {
    const isPayeeClause =
      clause.id === '12' || clause.text.includes('যার নামে চেক ইস্যু করা হবে');
    if (isPayeeClause) {
      const colonIdx = clause.text.indexOf(':');
      const prefix = colonIdx >= 0 ? clause.text.slice(0, colonIdx + 1) : clause.text;
      const payeeVal =
        data.payeeText || (colonIdx >= 0 ? clause.text.slice(colonIdx + 1).trim() : '');
      docChildren.push(
        new Paragraph({
          spacing: { before: 40, after: 100, line: 260 },
          children: [
            bnRun(`${clause.numberBn}. ${prefix} `, { size: 20 }),
            bnRun(payeeVal ? `${payeeVal}।` : '........................................................', {
              size: 20,
              bold: Boolean(payeeVal),
              underline: Boolean(payeeVal),
            }),
          ],
        })
      );
    } else {
      const lines = clause.text.split('\n');
      lines.forEach((line, idx) => {
        const prefix = idx === 0 ? `${clause.numberBn}. ` : '';
        const isSub = /^\([ক-ঙ]\)/.test(line.trim());
        docChildren.push(
          bnPara(`${prefix}${line}`, {
            align: AlignmentType.BOTH,
            size: 19,
            indentLeft: isSub ? 360 : 0,
            spaceAfter: idx === lines.length - 1 ? 45 : 20,
          })
        );
      });
    }
  }

  // [P2-S2] Signature Block (2 Columns)
  docChildren.push(
    new Table({
      width: { size: 10700, type: WidthType.DXA },
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            plainCell(
              [
                bnPara('* নিয়ন্ত্রণকারী/প্রতিস্বাক্ষরকারী কর্মকর্তার স্বাক্ষর', { size: 20, spaceAfter: 200 }),
                bnPara('নাম ....................................... পদবি ......................', { size: 20, spaceAfter: 180 }),
                bnPara('সিল', { size: 20, spaceAfter: 140 }),
                bnPara('স্থান ................................. তারিখ ..................', { size: 20, spaceAfter: 40 }),
              ],
              5350
            ),
            plainCell(
              [
                bnPara('বুঝে পেয়েছি ........................................................', { size: 20, spaceAfter: 120 }),
                bnPara('আয়ন কর্মকর্তার স্বাক্ষর', { size: 20, spaceAfter: 40 }),
                bnPara('নাম ....................................................................', { size: 20, spaceAfter: 40 }),
                bnPara('পদবি ...................................................................', { size: 20, spaceAfter: 160 }),
                bnPara('সিল', { size: 20, spaceAfter: 100 }),
                bnPara(
                  data.placeName
                    ? `স্থান ${data.placeName}`
                    : 'স্থান ...................................................................',
                  { size: 20, spaceAfter: 40 }
                ),
                bnPara('তারিখ ..................................................................', { size: 20, spaceAfter: 40 }),
              ],
              5350
            ),
          ],
        }),
      ],
    })
  );

  docChildren.push(bnPara('', { size: 14, spaceAfter: 80 }));

  // [P2-S3] Side-by-side Allocation & Expense Accounting Tables inside a 3-column layout wrapper
  const allocTable = new Table({
    width: { size: 5150, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          borderedCell([bnPara('বরাদ্দের হিসাব', { align: AlignmentType.CENTER, bold: true, size: 19, spaceAfter: 0 })], { width: 2950 }),
          borderedCell([bnPara('টাকা', { align: AlignmentType.CENTER, bold: true, size: 19, spaceAfter: 0 })], { width: 1450 }),
          borderedCell([bnPara('পয়সা', { align: AlignmentType.CENTER, bold: true, size: 19, spaceAfter: 0 })], { width: 750 }),
        ],
      }),
      new TableRow({
        children: [
          borderedCell([bnPara('১। শেষ বিলের টাকার অঙ্ক', { size: 18, spaceAfter: 0 })], { width: 2950 }),
          borderedCell([bnPara(data.allocationSummary.lastBillAmount.takaStr, { align: AlignmentType.RIGHT, size: 18, spaceAfter: 0 })], { width: 1450 }),
          borderedCell([bnPara(data.allocationSummary.lastBillAmount.paisaStr, { align: AlignmentType.CENTER, size: 18, spaceAfter: 0 })], { width: 750 }),
        ],
      }),
      new TableRow({
        children: [
          borderedCell(
            [
              bnPara(
                `২। এ যাবত অতিরিক্ত বরাদ্দ (পত্র নং ${data.allocationSummary.additionalRefNo || '....................'})`,
                { size: 18, spaceAfter: 0 }
              ),
            ],
            { width: 2950 }
          ),
          borderedCell([bnPara(data.allocationSummary.additionalAllocation.takaStr, { align: AlignmentType.RIGHT, size: 18, spaceAfter: 0 })], { width: 1450 }),
          borderedCell([bnPara(data.allocationSummary.additionalAllocation.paisaStr, { align: AlignmentType.CENTER, size: 18, spaceAfter: 0 })], { width: 750 }),
        ],
      }),
      new TableRow({
        children: [
          borderedCell(
            [
              bnPara(
                `৩। এ যাবত যে অঙ্কের বরাদ্দ কমানো হয়েছে। (পত্র নং ${data.allocationSummary.reducedRefNo || '...................'})`,
                { size: 18, spaceAfter: 0 }
              ),
            ],
            { width: 2950 }
          ),
          borderedCell([bnPara(data.allocationSummary.reducedAllocation.takaStr, { align: AlignmentType.RIGHT, size: 18, spaceAfter: 0 })], { width: 1450 }),
          borderedCell([bnPara(data.allocationSummary.reducedAllocation.paisaStr, { align: AlignmentType.CENTER, size: 18, spaceAfter: 0 })], { width: 750 }),
        ],
      }),
      new TableRow({
        children: [
          borderedCell([bnPara('৪। নিট মোট', { bold: true, size: 18, spaceAfter: 0 })], { width: 2950 }),
          borderedCell([bnPara(data.allocationSummary.netTotalAllocation.takaStr, { align: AlignmentType.RIGHT, bold: true, size: 18, spaceAfter: 0 })], { width: 1450 }),
          borderedCell([bnPara(data.allocationSummary.netTotalAllocation.paisaStr, { align: AlignmentType.CENTER, bold: true, size: 18, spaceAfter: 0 })], { width: 750 }),
        ],
      }),
    ],
  });

  const expenseTable = new Table({
    width: { size: 5150, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          borderedCell([bnPara('ব্যয়ের হিসাব', { align: AlignmentType.CENTER, bold: true, size: 19, spaceAfter: 0 })], { width: 2950 }),
          borderedCell([bnPara('টাকা', { align: AlignmentType.CENTER, bold: true, size: 19, spaceAfter: 0 })], { width: 1450 }),
          borderedCell([bnPara('পয়সা', { align: AlignmentType.CENTER, bold: true, size: 19, spaceAfter: 0 })], { width: 750 }),
        ],
      }),
      new TableRow({
        children: [
          borderedCell([bnPara('গত বিলের মোট জের (+)', { size: 18, spaceAfter: 0 })], { width: 2950 }),
          borderedCell([bnPara(data.expenseSummary.previousTotal.takaStr, { align: AlignmentType.RIGHT, size: 18, spaceAfter: 0 })], { width: 1450 }),
          borderedCell([bnPara(data.expenseSummary.previousTotal.paisaStr, { align: AlignmentType.CENTER, size: 18, spaceAfter: 0 })], { width: 750 }),
        ],
      }),
      new TableRow({
        children: [
          borderedCell([bnPara('এই বিলের মোট (+)', { size: 18, spaceAfter: 0 })], { width: 2950 }),
          borderedCell([bnPara(data.expenseSummary.currentBillTotal.takaStr, { align: AlignmentType.RIGHT, size: 18, spaceAfter: 0 })], { width: 1450 }),
          borderedCell([bnPara(data.expenseSummary.currentBillTotal.paisaStr, { align: AlignmentType.CENTER, size: 18, spaceAfter: 0 })], { width: 750 }),
        ],
      }),
      new TableRow({
        children: [
          borderedCell([bnPara('সংযুক্ত-পূর্তকর্মের বিলের টাকা', { size: 18, spaceAfter: 0 })], { width: 2950 }),
          borderedCell([bnPara(data.expenseSummary.attachedWorksAmount.takaStr, { align: AlignmentType.RIGHT, size: 18, spaceAfter: 0 })], { width: 1450 }),
          borderedCell([bnPara(data.expenseSummary.attachedWorksAmount.paisaStr, { align: AlignmentType.CENTER, size: 18, spaceAfter: 0 })], { width: 750 }),
        ],
      }),
      new TableRow({
        children: [
          borderedCell([bnPara('মোট (পরবর্তী বিলে জের টেনে নেওয়া হবে।', { bold: true, size: 18, spaceAfter: 0 })], { width: 2950 }),
          borderedCell([bnPara(data.expenseSummary.cumulativeTotal.takaStr, { align: AlignmentType.RIGHT, bold: true, size: 18, spaceAfter: 0 })], { width: 1450 }),
          borderedCell([bnPara(data.expenseSummary.cumulativeTotal.paisaStr, { align: AlignmentType.CENTER, bold: true, size: 18, spaceAfter: 0 })], { width: 750 }),
        ],
      }),
    ],
  });

  docChildren.push(
    new Table({
      width: { size: 10700, type: WidthType.DXA },
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 5150, type: WidthType.DXA },
              borders: NO_BORDERS,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: [allocTable],
            }),
            plainCell([bnPara('', { spaceAfter: 0 })], 400),
            new TableCell({
              width: { size: 5150, type: WidthType.DXA },
              borders: NO_BORDERS,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: [expenseTable],
            }),
          ],
        }),
      ],
    })
  );

  // [P2-S4] Accounting Office Block (হিসাবরক্ষণ অফিসের ব্যবহারের জন্য) & Cheque Issuer Signature
  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { top: CELL_BORDER },
      spacing: { before: 220, after: 40 },
      children: [bnRun('হিসাবরক্ষণ অফিসের ব্যবহারের জন্য', { bold: true, size: 20 })],
    })
  );
  docChildren.push(
    bnPara(
      'প্রদানের জন্য পাস করা হল, টাকা ....................................... কথায়.......................................................................',
      { size: 19, spaceAfter: 240 }
    )
  );

  docChildren.push(
    new Table({
      width: { size: 10700, type: WidthType.DXA },
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            plainCell(
              [
                bnPara('_____________________________', { size: 18, spaceAfter: 20 }),
                bnPara('অডিটর (স্বাক্ষর)', { size: 19, spaceAfter: 20 }),
                bnPara('নাম .......................................', { size: 19, spaceAfter: 20 }),
                bnPara('তাং.......................................', { size: 19, spaceAfter: 180 }),
                bnPara('সিল', { size: 19, spaceAfter: 20 }),
              ],
              3550
            ),
            plainCell(
              [
                bnPara('_____________________________', { size: 18, spaceAfter: 20 }),
                bnPara('সুপার (স্বাক্ষর)', { size: 19, spaceAfter: 20 }),
                bnPara('নাম .......................................', { size: 19, spaceAfter: 20 }),
                bnPara('তাং.......................................', { size: 19, spaceAfter: 180 }),
                bnPara('সিল', { size: 19, spaceAfter: 180 }),
                bnPara('চেক নং ..............................', { size: 19, spaceAfter: 20 }),
              ],
              3550
            ),
            plainCell(
              [
                bnPara('___________________________________', { size: 18, spaceAfter: 20 }),
                bnPara('নিরীক্ষা ও হিসাবরক্ষণ অফিসার (স্বাক্ষর)', { size: 19, spaceAfter: 20 }),
                bnPara('নাম .......................................', { size: 19, spaceAfter: 20 }),
                bnPara('তাং.......................................', { size: 19, spaceAfter: 180 }),
                bnPara('সিল', { size: 19, spaceAfter: 180 }),
                bnPara('তারিখ...................................', { size: 19, spaceAfter: 20 }),
              ],
              3600
            ),
          ],
        }),
      ],
    })
  );

  // Cheque Issuer Signature (bottom right)
  docChildren.push(
    new Table({
      width: { size: 10700, type: WidthType.DXA },
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            plainCell([bnPara('', { spaceAfter: 0 })], 7100),
            plainCell(
              [
                bnPara('_____________________________', { align: AlignmentType.CENTER, size: 18, spaceBefore: 240, spaceAfter: 20 }),
                bnPara('চেক প্রদানকারীর স্বাক্ষর', { align: AlignmentType.CENTER, size: 19, spaceAfter: 20 }),
                bnPara('নাম .......................................', { size: 19, spaceAfter: 20 }),
                bnPara('তাং .......................................', { size: 19, spaceAfter: 20 }),
                bnPara('সিল', { size: 19, spaceAfter: 0 }),
              ],
              3600
            ),
          ],
        }),
      ],
    })
  );

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: FONT_BN,
            size: 20,
            color: '000000',
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906, // A4 Portrait 210mm
              height: 16838, // A4 Portrait 297mm
            },
            margin: {
              top: 567,
              right: 567,
              bottom: 567,
              left: 620,
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  return saveAndShareFile({
    data: blob,
    fileName: `${buildFileBase(billNoForFile)}.docx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    title: `টি.আর. ফরম নং-২১ (${billNoForFile})`,
  });
}
