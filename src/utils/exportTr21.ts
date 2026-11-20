import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Capacitor } from '@capacitor/core';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import {
  AlignmentType,
  BorderStyle,
  Document,
  LeaderType,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TabStopType,
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
  host.setAttribute('data-tr21-export-host', 'true');
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
let activeDocFont = FONT_BN;
let activeFontScale = 1;
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
  opts?: { bold?: boolean; size?: number; underline?: boolean | 'dotted'; color?: string }
): TextRun {
  const scaledSize = Math.max(12, Math.round((opts?.size ?? 20) * activeFontScale));
  return new TextRun({
    text,
    font: {
      name: activeDocFont,
      ascii: activeDocFont,
      hAnsi: activeDocFont,
      cs: activeDocFont,
      eastAsia: activeDocFont,
    },
    size: scaledSize, // half-points (20 = 10pt)
    bold: opts?.bold,
    color: opts?.color ?? '000000',
    underline:
      opts?.underline === 'dotted'
        ? { type: UnderlineType.DOTTED, color: '000000' }
        : opts?.underline
        ? { type: UnderlineType.SINGLE }
        : undefined,
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
  activeDocFont = data.fontFamily || FONT_BN;
  activeFontScale = (data.fontSize && Number.isFinite(data.fontSize) ? data.fontSize : 11) / 11;
  try {
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

  // [P1-S1] Page 1 Header Table (Top-left form no | Center title, ministry, office, address | Right mobile)
  const centerHeaderParas: Paragraph[] = [
    bnPara('ক্রয়, সরবরাহ ও সেবা বাবদ ব্যয়ের বিল', {
      align: AlignmentType.CENTER,
      bold: true,
      size: 26,
      spaceAfter: 20,
    }),
  ];
  if (data.ministryName) {
    centerHeaderParas.push(
      bnPara(data.ministryName, { align: AlignmentType.CENTER, size: 21, spaceAfter: 10 })
    );
  }
  centerHeaderParas.push(
    bnPara(data.officeName, { align: AlignmentType.CENTER, size: 21, spaceAfter: 10 })
  );
  if (data.officeAddress) {
    centerHeaderParas.push(
      bnPara(data.officeAddress, { align: AlignmentType.CENTER, size: 20, spaceAfter: 0 })
    );
  }

  docChildren.push(
    new Table({
      width: { size: 10700, type: WidthType.DXA },
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            plainCell(
              [
                bnPara('টি.আর ফরম নং ২১', { size: 18, spaceAfter: 10 }),
                bnPara('(এস, আর ১৮৩ দ্রষ্টব্য)', { size: 18, spaceAfter: 0 }),
              ],
              2400
            ),
            plainCell(centerHeaderParas, 5600),
            plainCell(
              [
                bnPara(
                  data.officeMobileNoBn ? `মোবাইল নং: ${data.officeMobileNoBn}` : '',
                  { align: AlignmentType.RIGHT, bold: true, size: 18, spaceAfter: 0 }
                ),
              ],
              2700
            ),
          ],
        }),
      ],
    })
  );

  // [P1-S2] Grouped Code Boxes (1 - 4 - 4 - 4) + Token / Voucher / Dates
  const codeRowCells: TableCell[] = [
    plainCell([bnPara('কোড নং', { size: 20, spaceAfter: 0 })], 1950),
  ];
  data.institutionalCodeGroups.forEach((group, gIdx) => {
    if (gIdx > 0) {
      codeRowCells.push(
        plainCell([bnPara('-', { align: AlignmentType.CENTER, bold: true, size: 20, spaceAfter: 0 })], 240)
      );
    }
    group.forEach((digit) => {
      codeRowCells.push(
        borderedCell(
          [bnPara(digit, { align: AlignmentType.CENTER, size: 20, spaceAfter: 0 })],
          {
            width: 340,
            vAlign: VerticalAlign.CENTER,
            margins: { top: 30, bottom: 30, left: 20, right: 20 },
          }
        )
      );
    });
  });
  codeRowCells.push(plainCell([bnPara('', { spaceAfter: 0 })], 3610));

  docChildren.push(
    new Table({
      width: { size: 10700, type: WidthType.DXA },
      borders: NO_BORDERS,
      rows: [new TableRow({ children: codeRowCells })],
    })
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
                new Paragraph({
                  alignment: AlignmentType.LEFT,
                  spacing: { before: 0, after: 30, line: 260 },
                  children: [
                    bnRun('টোকেন নং: ', { size: 20 }),
                    data.tokenNoBn
                      ? bnRun(` ${data.tokenNoBn} `, { size: 20, bold: true, underline: 'dotted' })
                      : bnRun('................', { size: 20 }),
                  ],
                }),
              ],
              2850
            ),
            plainCell([bnPara('তারিখ: ................', { size: 20, spaceAfter: 30 })], 2350),
            plainCell(
              [
                new Paragraph({
                  alignment: AlignmentType.LEFT,
                  spacing: { before: 0, after: 30, line: 260 },
                  children: [
                    bnRun('ভাউচার নং: ', { size: 20 }),
                    data.voucherNoBn
                      ? bnRun(` ${data.voucherNoBn} `, { size: 20, bold: true, underline: 'dotted' })
                      : bnRun('..............', { size: 20 }),
                  ],
                }),
              ],
              2900
            ),
            plainCell(
              [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { before: 0, after: 30, line: 260 },
                  children: [
                    bnRun('তারিখ: ', { size: 20 }),
                    data.billDateShortBn
                      ? bnRun(` ${data.billDateShortBn} `, { size: 20, underline: 'dotted' })
                      : bnRun('..............', { size: 20 }),
                  ],
                }),
              ],
              2600
            ),
          ],
        }),
      ],
    })
  );

  // [P1-S3] Main Table (অর্থনৈতিক কোড | বিবরণ | পরিমাণ (টাকা | পয়সা))
  const C1 = 1850;
  const C2 = 5750;
  const C3 = 2150;
  const C4 = 950;

  const supplierParts: string[] = [];
  if (data.supplier?.name?.trim()) supplierParts.push(`সরবরাহকারী: ${data.supplier.name.trim()}`);
  if (data.supplier?.address?.trim()) supplierParts.push(`ঠিকানা: ${data.supplier.address.trim()}`);
  if (data.supplier?.tinBin?.trim()) supplierParts.push(`টিআইএন/বিআইএন: ${data.supplier.tinBin.trim()}`);
  const supplierLine = supplierParts.join(' · ');

  const mainRows: TableRow[] = [
    // Header Row 1
    new TableRow({
      tableHeader: true,
      children: [
        borderedCell(
          [bnPara('অর্থনৈতিক কোড', { align: AlignmentType.CENTER, bold: true, size: 20, spaceAfter: 0 })],
          { width: C1, verticalMerge: VerticalMergeType.RESTART, vAlign: VerticalAlign.CENTER }
        ),
        borderedCell(
          [bnPara('বিবরণ', { align: AlignmentType.CENTER, bold: true, size: 20, spaceAfter: 0 })],
          { width: C2, verticalMerge: VerticalMergeType.RESTART, vAlign: VerticalAlign.CENTER }
        ),
        borderedCell(
          [bnPara('পরিমাণ', { align: AlignmentType.CENTER, bold: true, size: 20, spaceAfter: 0 })],
          { width: C3 + C4, columnSpan: 2, vAlign: VerticalAlign.CENTER }
        ),
      ],
    }),
    // Header Row 2
    new TableRow({
      tableHeader: true,
      children: [
        borderedCell([bnPara('', { spaceAfter: 0 })], {
          width: C1,
          verticalMerge: VerticalMergeType.CONTINUE,
        }),
        borderedCell([bnPara('', { spaceAfter: 0 })], {
          width: C2,
          verticalMerge: VerticalMergeType.CONTINUE,
        }),
        borderedCell(
          [bnPara('টাকা', { align: AlignmentType.CENTER, bold: true, size: 19, spaceAfter: 0 })],
          { width: C3 }
        ),
        borderedCell(
          [bnPara('পয়সা', { align: AlignmentType.CENTER, bold: true, size: 19, spaceAfter: 0 })],
          { width: C4 }
        ),
      ],
    }),
  ];

  // Intro & Item/Voucher Rows
  const codeCellContent = [
    bnPara(data.economicCodeBn, { bold: true, size: 20, spaceAfter: 15 }),
    ...(data.headNameBn ? [bnPara(data.headNameBn, { size: 19, spaceAfter: 0 })] : []),
  ];

  mainRows.push(
    new TableRow({
      children: [
        borderedCell(codeCellContent, { width: C1, verticalMerge: VerticalMergeType.RESTART }),
        borderedCell(
          [
            bnPara(data.introText, {
              align: AlignmentType.BOTH,
              size: 20,
              spaceAfter: 120,
            }),
          ],
          {
            width: C2,
            borders: { top: CELL_BORDER, bottom: NO_BORDER },
            margins: { top: 65, bottom: 110, left: 90, right: 90 },
          }
        ),
        borderedCell([bnPara('', { spaceAfter: 0 })], {
          width: C3,
          borders: { top: CELL_BORDER, bottom: NO_BORDER },
        }),
        borderedCell([bnPara('', { spaceAfter: 0 })], {
          width: C4,
          borders: { top: CELL_BORDER, bottom: NO_BORDER },
        }),
      ],
    })
  );

  const displayRows = data.displayRows?.length
    ? data.displayRows
    : [
        {
          indexBn: '১',
          description: data.purposeText,
          responsibleText: '',
          amountPaisa: data.gross.amountPaisa || 0,
          takaStr: data.gross.takaStr,
          paisaStr: data.gross.paisaStr,
        },
      ];

  displayRows.forEach((it, idx) => {
    const isLast = idx === displayRows.length - 1 && !supplierLine;
    mainRows.push(
      new TableRow({
        children: [
          borderedCell([bnPara('', { spaceAfter: 0 })], {
            width: C1,
            verticalMerge: VerticalMergeType.CONTINUE,
          }),
          borderedCell(
            [
              new Paragraph({
                spacing: { before: 0, after: isLast ? 110 : 15, line: 260 },
                indent: { left: 200 },
                tabStops: [
                  {
                    type: TabStopType.RIGHT,
                    position: 5420,
                    leader: LeaderType.DOT,
                  },
                ],
                children: [bnRun(`${it.indexBn}) ${it.description}\t`, { size: 20 })],
              }),
            ],
            {
              width: C2,
              borders: {
                top: NO_BORDER,
                bottom: isLast ? CELL_BORDER : NO_BORDER,
              },
              margins: { top: 20, bottom: isLast ? 90 : 15, left: 90, right: 90 },
            }
          ),
          borderedCell([bnPara(it.takaStr, { align: AlignmentType.RIGHT, size: 20, spaceAfter: 0 })], {
            width: C3,
            borders: {
              top: NO_BORDER,
              bottom: isLast ? CELL_BORDER : NO_BORDER,
            },
            margins: { top: 20, bottom: isLast ? 90 : 15, left: 80, right: 80 },
          }),
          borderedCell([bnPara(it.paisaStr, { align: AlignmentType.CENTER, size: 20, spaceAfter: 0 })], {
            width: C4,
            borders: {
              top: NO_BORDER,
              bottom: isLast ? CELL_BORDER : NO_BORDER,
            },
            margins: { top: 20, bottom: isLast ? 90 : 15, left: 40, right: 40 },
          }),
        ],
      })
    );
  });

  if (supplierLine) {
    mainRows.push(
      new TableRow({
        children: [
          borderedCell([bnPara('', { spaceAfter: 0 })], {
            width: C1,
            verticalMerge: VerticalMergeType.CONTINUE,
          }),
          borderedCell([bnPara(supplierLine, { size: 18, spaceAfter: 40 })], {
            width: C2,
            borders: { top: NO_BORDER, bottom: CELL_BORDER },
          }),
          borderedCell([bnPara('', { spaceAfter: 0 })], {
            width: C3,
            borders: { top: NO_BORDER, bottom: CELL_BORDER },
          }),
          borderedCell([bnPara('', { spaceAfter: 0 })], {
            width: C4,
            borders: { top: NO_BORDER, bottom: CELL_BORDER },
          }),
        ],
      })
    );
  }

  // Gross Total Row
  mainRows.push(
    new TableRow({
      children: [
        borderedCell([bnPara('', { spaceAfter: 0 })], { width: C1 }),
        borderedCell(
          [bnPara('মোট টাকা (ক)', { align: AlignmentType.RIGHT, bold: true, size: 20, spaceAfter: 0 })],
          { width: C2 }
        ),
        borderedCell(
          [bnPara(data.gross.takaStr, { align: AlignmentType.RIGHT, bold: true, size: 20, spaceAfter: 0 })],
          { width: C3 }
        ),
        borderedCell(
          [bnPara(data.gross.paisaStr, { align: AlignmentType.CENTER, bold: true, size: 20, spaceAfter: 0 })],
          { width: C4 }
        ),
      ],
    }),
    // [P1-S4] Deductions Sub-header
    new TableRow({
      children: [
        borderedCell([bnPara('কর্তন ও পরিশোধ', { bold: true, size: 20, spaceAfter: 0 })], {
          width: 10700,
          columnSpan: 4,
        }),
      ],
    })
  );

  // Deduction Rows with Unicode ballot box ☐
  data.deductions.forEach((d) => {
    mainRows.push(
      new TableRow({
        children: [
          borderedCell([bnPara(`☐  ${d.codeBn}`, { size: 20, spaceAfter: 0 })], { width: C1 }),
          borderedCell([bnPara(d.label, { size: 20, spaceAfter: 0 })], { width: C2 }),
          borderedCell([bnPara(d.takaStr, { align: AlignmentType.RIGHT, size: 20, spaceAfter: 0 })], {
            width: C3,
          }),
          borderedCell([bnPara(d.paisaStr, { align: AlignmentType.CENTER, size: 20, spaceAfter: 0 })], {
            width: C4,
          }),
        ],
      })
    );
  });

  // Total Deduction + Net Payable + Words
  mainRows.push(
    new TableRow({
      children: [
        borderedCell([bnPara('', { spaceAfter: 0 })], { width: C1 }),
        borderedCell(
          [
            bnPara('কর্তন ও পরিশোধ বাবদ মোট আদায় (খ):', {
              align: AlignmentType.RIGHT,
              size: 20,
              spaceAfter: 0,
            }),
          ],
          { width: C2 }
        ),
        borderedCell(
          [bnPara(data.totalDeduction.takaStr, { align: AlignmentType.RIGHT, size: 20, spaceAfter: 0 })],
          { width: C3 }
        ),
        borderedCell(
          [bnPara(data.totalDeduction.paisaStr, { align: AlignmentType.CENTER, size: 20, spaceAfter: 0 })],
          { width: C4 }
        ),
      ],
    }),
    new TableRow({
      children: [
        borderedCell([bnPara(`☐  ${data.netPayableCodeBn}`, { size: 20, spaceAfter: 0 })], {
          width: C1,
        }),
        borderedCell([bnPara('প্রদেয় বিল (ক-খ)', { size: 20, spaceAfter: 0 })], { width: C2 }),
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
        borderedCell([bnPara(`নেট বিল (কথায়): ${data.netPayableInWords}।`, { size: 20, spaceAfter: 0 })], {
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

  const pushClauseParagraphs = (
    clauses: Tr21FormData['page1Clauses'],
    paragraphSpaceAfter: number
  ) => {
    for (const clause of clauses) {
      const isPayeeClause =
        clause.id === '7' ||
        clause.id === '12' ||
        clause.text.includes('যাহার নামে ইস্যু করা হইবে') ||
        clause.text.includes('যার নামে চেক ইস্যু করা হবে');
      if (isPayeeClause) {
        const colonIdx = clause.text.indexOf(':');
        const prefix = colonIdx >= 0 ? clause.text.slice(0, colonIdx + 1) : clause.text;
        const payeeVal =
          data.payeeText || (colonIdx >= 0 ? clause.text.slice(colonIdx + 1).trim() : '');
        docChildren.push(
          new Paragraph({
            spacing: { before: 40, after: 120, line: 260 },
            children: [
              bnRun(`${clause.numberBn}। ${prefix} `, { size: 20 }),
              bnRun(payeeVal || '........................................................', {
                size: 20,
                bold: Boolean(payeeVal),
              }),
            ],
          })
        );
      } else {
        const lines = clause.text.split('\n');
        lines.forEach((line, idx) => {
          const prefix = idx === 0 ? `${clause.numberBn}। ` : '';
          const isSub = /^\([ক-ঙ]\)/.test(line.trim());
          docChildren.push(
            bnPara(`${prefix}${line}`, {
              align: AlignmentType.BOTH,
              size: 19,
              indentLeft: isSub ? 460 : 0,
              spaceAfter: idx === lines.length - 1 ? paragraphSpaceAfter : 18,
            })
          );
        });
      }
    }
  };

  // [P1-S5] Page 1 Clauses
  docChildren.push(bnPara('', { size: 10, spaceAfter: 30 }));
  pushClauseParagraphs(data.page1Clauses, 35);

  // Page 1 Footer
  docChildren.push(
    new Table({
      width: { size: 10700, type: WidthType.DXA },
      borders: {
        top: CELL_BORDER,
        bottom: NO_BORDER,
        left: NO_BORDER,
        right: NO_BORDER,
        insideHorizontal: NO_BORDER,
        insideVertical: NO_BORDER,
      },
      rows: [
        new TableRow({
          children: [
            plainCell([bnPara(data.footerLeftText, { size: 18, spaceAfter: 0 })], 8000),
            plainCell(
              [bnPara('Page 1 of 2', { align: AlignmentType.RIGHT, size: 18, spaceAfter: 0 })],
              2700
            ),
          ],
        }),
      ],
    })
  );

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

  // [P2-S1] Page 2 Clauses
  pushClauseParagraphs(data.page2Clauses, 45);

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
                bnPara('* নিয়ন্ত্রণকারী/প্রতিস্বাক্ষরকারী কর্মকর্তার স্বাক্ষর', {
                  bold: true,
                  size: 19,
                  spaceAfter: 30,
                }),
                bnPara('......................................................................', {
                  size: 19,
                  spaceAfter: 30,
                }),
                bnPara('নাম..................................................................', {
                  size: 19,
                  spaceAfter: 30,
                }),
                bnPara('পদবী................................................................', {
                  size: 19,
                  spaceAfter: 160,
                }),
                bnPara('সীল..................................................................', {
                  size: 19,
                  spaceAfter: 30,
                }),
                bnPara('স্থান................................................................', {
                  size: 19,
                  spaceAfter: 30,
                }),
                bnPara('তারিখ..............................................................', {
                  size: 19,
                  spaceAfter: 40,
                }),
              ],
              5350
            ),
            plainCell(
              [
                bnPara('বুঝিয়া পাইয়াছি ...................................................', {
                  size: 19,
                  spaceAfter: 30,
                }),
                bnPara('আয়ন ব্যয়ন কর্মকর্তার স্বাক্ষর.....................................', {
                  size: 19,
                  spaceAfter: 30,
                }),
                bnPara('নাম...................................................................', {
                  size: 19,
                  spaceAfter: 30,
                }),
                bnPara('পদবী.................................................................', {
                  size: 19,
                  spaceAfter: 160,
                }),
                bnPara('সীল...................................................................', {
                  size: 19,
                  spaceAfter: 30,
                }),
                bnPara(
                  data.placeName
                    ? `স্থান ${data.placeName}`
                    : 'স্থান..................................................................',
                  { size: 19, spaceAfter: 30 }
                ),
                bnPara('তারিখ...............................................................', {
                  size: 19,
                  spaceAfter: 40,
                }),
              ],
              5350
            ),
          ],
        }),
      ],
    })
  );

  docChildren.push(bnPara('', { size: 12, spaceAfter: 60 }));

  // [P2-S3] Side-by-side 2-Column Allocation & Expense Accounting Tables
  const allocTable = new Table({
    width: { size: 5150, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          borderedCell([bnPara('বরাদ্দের হিসাব', { bold: true, size: 19, spaceAfter: 0 })], {
            width: 3750,
          }),
          borderedCell([bnPara('টাকা', { align: AlignmentType.CENTER, bold: true, size: 19, spaceAfter: 0 })], {
            width: 1400,
          }),
        ],
      }),
      new TableRow({
        children: [
          borderedCell([bnPara('১। শেষ বিলের টাকার অংক', { size: 18, spaceAfter: 0 })], { width: 3750 }),
          borderedCell(
            [bnPara(data.allocationSummary.lastBillAmount.takaStr, { align: AlignmentType.RIGHT, size: 18, spaceAfter: 0 })],
            { width: 1400 }
          ),
        ],
      }),
      new TableRow({
        children: [
          borderedCell(
            [
              bnPara(
                `২। এ যাবত অতিরিক্ত বরাদ্দ (পত্র নং ${data.allocationSummary.additionalRefNo || '........'})`,
                { size: 18, spaceAfter: 0 }
              ),
            ],
            { width: 3750 }
          ),
          borderedCell(
            [bnPara(data.allocationSummary.additionalAllocation.takaStr, { align: AlignmentType.RIGHT, size: 18, spaceAfter: 0 })],
            { width: 1400 }
          ),
        ],
      }),
      new TableRow({
        children: [
          borderedCell(
            [
              bnPara(
                `৩। এ যাবত যে অংকের বরাদ্দ কমানো হইয়াছে। (পত্র নং ${data.allocationSummary.reducedRefNo || '........'})`,
                { size: 18, spaceAfter: 0 }
              ),
            ],
            { width: 3750 }
          ),
          borderedCell(
            [bnPara(data.allocationSummary.reducedAllocation.takaStr, { align: AlignmentType.RIGHT, size: 18, spaceAfter: 0 })],
            { width: 1400 }
          ),
        ],
      }),
      new TableRow({
        children: [
          borderedCell([bnPara('৪। নীট মোট', { bold: true, size: 18, spaceAfter: 0 })], { width: 3750 }),
          borderedCell(
            [bnPara(data.allocationSummary.netTotalAllocation.takaStr, { align: AlignmentType.RIGHT, bold: true, size: 18, spaceAfter: 0 })],
            { width: 1400 }
          ),
        ],
      }),
    ],
  });

  const expenseTable = new Table({
    width: { size: 5150, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          borderedCell([bnPara('ব্যয়ের হিসাব', { bold: true, size: 19, spaceAfter: 0 })], {
            width: 3750,
          }),
          borderedCell([bnPara('টাকা', { align: AlignmentType.CENTER, bold: true, size: 19, spaceAfter: 0 })], {
            width: 1400,
          }),
        ],
      }),
      new TableRow({
        children: [
          borderedCell([bnPara('গত বিলের মোট জের (+)', { size: 18, spaceAfter: 0 })], { width: 3750 }),
          borderedCell(
            [bnPara(data.expenseSummary.previousTotal.takaStr, { align: AlignmentType.RIGHT, size: 18, spaceAfter: 0 })],
            { width: 1400 }
          ),
        ],
      }),
      new TableRow({
        children: [
          borderedCell([bnPara('এই বিলের মোট (+)', { size: 18, spaceAfter: 0 })], { width: 3750 }),
          borderedCell(
            [bnPara(data.expenseSummary.currentBillTotal.takaStr, { align: AlignmentType.RIGHT, size: 18, spaceAfter: 0 })],
            { width: 1400 }
          ),
        ],
      }),
      new TableRow({
        children: [
          borderedCell([bnPara('সংযুক্ত পূর্তকর্মের বিলের টাকা', { size: 18, spaceAfter: 0 })], {
            width: 3750,
          }),
          borderedCell(
            [bnPara(data.expenseSummary.attachedWorksAmount.takaStr, { align: AlignmentType.RIGHT, size: 18, spaceAfter: 0 })],
            { width: 1400 }
          ),
        ],
      }),
      new TableRow({
        children: [
          borderedCell([bnPara('মোট (পরবর্তী বিলের জের টানিয়া)', { bold: true, size: 18, spaceAfter: 0 })], {
            width: 3750,
          }),
          borderedCell(
            [bnPara(data.expenseSummary.cumulativeTotal.takaStr, { align: AlignmentType.RIGHT, bold: true, size: 18, spaceAfter: 0 })],
            { width: 1400 }
          ),
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

  // [P2-S4] Accounting Office Block (হিসাবরক্ষণ অফিসে ব্যবহারের জন্য)
  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { bottom: CELL_BORDER },
      spacing: { before: 120, after: 80 },
      children: [bnRun('হিসাবরক্ষণ অফিসে ব্যবহারের জন্য', { bold: true, size: 20 })],
    })
  );
  docChildren.push(
    bnPara(
      'প্রদানের জন্য পাস করা হইল টাকা .................................. কথায় .....................................................................',
      { size: 19, spaceAfter: 480 }
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
                bnPara('অডিটর (স্বাক্ষর)', { bold: true, size: 19, spaceAfter: 20 }),
                bnPara('নাম...................................', { size: 19, spaceAfter: 20 }),
                bnPara('তাং ..................................', { size: 19, spaceAfter: 20 }),
              ],
              3550
            ),
            plainCell(
              [
                bnPara('সুপার (স্বাক্ষর)', { size: 19, spaceAfter: 20 }),
                bnPara('নাম...................................', { size: 19, spaceAfter: 20 }),
                bnPara('তাং...................................', { size: 19, spaceAfter: 20 }),
                bnPara('চেক নং...............................', { size: 19, spaceAfter: 20 }),
              ],
              3550
            ),
            plainCell(
              [
                bnPara('হিসাবরক্ষণ অফিসার (স্বাক্ষর)', { bold: true, size: 19, spaceAfter: 20 }),
                bnPara('নাম...................................', { size: 19, spaceAfter: 20 }),
                bnPara('তাং...................................', { size: 19, spaceAfter: 260 }),
                bnPara('চেক প্রদানকারীর স্বাক্ষর...............', { size: 19, spaceAfter: 20 }),
                bnPara('নাম...................................', { size: 19, spaceAfter: 20 }),
              ],
              3600
            ),
          ],
        }),
      ],
    })
  );

  // [P2-S5] Bottom Liability Note + Page 2 Footer
  docChildren.push(
    new Paragraph({
      border: { top: CELL_BORDER },
      spacing: { before: 320, after: 30 },
      children: [bnRun('* কেবল মাত্র প্রযোজ্য ক্ষেত্রে।', { size: 18 })],
    })
  );
  docChildren.push(
    bnPara(
      'বিঃ দ্রঃ ইহা স্পষ্টভাবে রাখিতে হইবে যে, বরাদ্দের অতিরিক্ত ব্যয়ের জন্য আয়ন কর্মকর্তা ব্যক্তিগতভাবে দায়ী থাকিবেন। বরাদ্দের অতিরিক্ত ব্যয়ের বিপরীতে যদি তিনি অতিরিক্ত বরাদ্দ মঞ্জুর করাইতে না পারেন, তবে অতিরিক্ত ব্যয়িত অর্থ তাহার ব্যক্তিগত ভাতাদি হইতে আদায় করা হইবে।',
      { align: AlignmentType.BOTH, size: 18, spaceAfter: 220 }
    )
  );

  docChildren.push(
    new Table({
      width: { size: 10700, type: WidthType.DXA },
      borders: {
        top: CELL_BORDER,
        bottom: NO_BORDER,
        left: NO_BORDER,
        right: NO_BORDER,
        insideHorizontal: NO_BORDER,
        insideVertical: NO_BORDER,
      },
      rows: [
        new TableRow({
          children: [
            plainCell([bnPara(data.footerLeftText, { size: 18, spaceAfter: 0 })], 8000),
            plainCell(
              [bnPara('Page 2 of 2', { align: AlignmentType.RIGHT, size: 18, spaceAfter: 0 })],
              2700
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
            font: activeDocFont,
            size: Math.max(12, Math.round(20 * activeFontScale)),
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
              top: 520,
              right: 540,
              bottom: 500,
              left: 560,
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
  } finally {
    activeDocFont = FONT_BN;
    activeFontScale = 1;
  }
}
