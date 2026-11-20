import React from 'react';
import type { Tr21FormData } from '../lib/billFormData';

export interface Tr21SectionMeta {
  id: string;
  page: 1 | 2;
  titleBn: string;
  summaryBn: string;
  color: string;
}

export const TR21_FORM_SECTIONS: Tr21SectionMeta[] = [
  {
    id: 'P1-S1',
    page: 1,
    titleBn: 'শিরোনাম, মন্ত্রণালয় ও দপ্তর তথ্য',
    summaryBn: 'টি.আর ফরম নং ২১ (এস.আর ১৮৩), বিলের শিরোনাম, মন্ত্রণালয়, দপ্তর, ঠিকানা ও মোবাইল নং',
    color: '#0f766e',
  },
  {
    id: 'P1-S2',
    page: 1,
    titleBn: 'কোড নং (১-৪-৪-৪), টোকেন ও ভাউচার',
    summaryBn: '১৩ ঘরের কোড বক্স (১-৪-৪-৪), টোকেন নং, তারিখ, ভাউচার নং ও বিলের তারিখ',
    color: '#0369a1',
  },
  {
    id: 'P1-S3',
    page: 1,
    titleBn: 'মূল ছক (ক): বিবরণ ও মোট টাকা',
    summaryBn: 'অর্থনৈতিক কোড ও খাতের নাম, বরাদ্দ/উদ্দেশ্য বিবরণ ও ভাউচার তালিকা, পরিমাণ (টাকা/পয়সা) ও মোট টাকা (ক)',
    color: '#7c3aed',
  },
  {
    id: 'P1-S4',
    page: 1,
    titleBn: 'মূল ছক (খ): কর্তন, প্রদেয় বিল ও নেট কথায়',
    summaryBn: 'আয়কর/মূসক/নিরাপত্তা জমা (চেকবক্স ও কোডসহ), মোট আদায় (খ), প্রদেয় বিল (ক-খ) ও নেট কথায়',
    color: '#b45309',
  },
  {
    id: 'P1-S5',
    page: 1,
    titleBn: 'পাতা-১ প্রত্যয়নসমূহ (১–৪)',
    summaryBn: '১ থেকে ৪ নম্বর প্রত্যয়ন অনুচ্ছেদসমূহ ও নিচের ফুটার (Page 1 of 2)',
    color: '#be123c',
  },
  {
    id: 'P2-S1',
    page: 2,
    titleBn: 'পাতা-২ প্রত্যয়ন ও প্রাপক (৫–৭)',
    summaryBn: '৫, ৬ (ক–ঘ) এবং ৭ নম্বর প্রাপক (যাহার নামে ইস্যু করা হইবে)',
    color: '#0f766e',
  },
  {
    id: 'P2-S2',
    page: 2,
    titleBn: 'কর্মকর্তাদের স্বাক্ষর ও সিল ব্লক',
    summaryBn: 'বামে নিয়ন্ত্রণকারী/প্রতিস্বাক্ষরকারী এবং ডানে বুঝিয়া পাইয়াছি ও আয়ন ব্যয়ন কর্মকর্তা',
    color: '#0369a1',
  },
  {
    id: 'P2-S3',
    page: 2,
    titleBn: 'বরাদ্দের হিসাব ও ব্যয়ের হিসাব টেবিল',
    summaryBn: 'পাশাপাশি ২ কলামের বরাদ্দের হিসাব (টাকা) ও ব্যয়ের হিসাব (টাকা) টেবিল',
    color: '#7c3aed',
  },
  {
    id: 'P2-S4',
    page: 2,
    titleBn: 'হিসাবরক্ষণ অফিস ও চেক প্রদান',
    summaryBn: 'পাস করা টাকার লাইন, অডিটর/সুপার/হিসাবরক্ষণ অফিসার ও চেক প্রদানকারীর স্বাক্ষর',
    color: '#b45309',
  },
  {
    id: 'P2-S5',
    page: 2,
    titleBn: 'বিঃ দ্রঃ ও ব্যক্তিগত দায়বদ্ধতা নোট',
    summaryBn: 'বরাদ্দের অতিরিক্ত ব্যয়ের জন্য আয়ন কর্মকর্তার ব্যক্তিগত দায়বদ্ধতা নির্দেশনা ও ফুটার',
    color: '#be123c',
  },
];

const SECTION_META_MAP = new Map(TR21_FORM_SECTIONS.map((s) => [s.id, s]));

interface BillFormProps {
  data: Tr21FormData;
  className?: string;
  showSectionGuides?: boolean;
}

function SectionBadge({ sectionId }: { sectionId: string }) {
  const meta = SECTION_META_MAP.get(sectionId);
  if (!meta) return null;
  return (
    <span
      data-no-export="true"
      style={{
        position: 'absolute',
        top: '-9px',
        left: '4px',
        zIndex: 30,
        backgroundColor: meta.color,
        color: '#ffffff',
        fontFamily: 'Inter, Noto Sans Bengali, sans-serif',
        fontSize: '9.5px',
        fontWeight: 700,
        lineHeight: 1.2,
        padding: '1px 6px',
        borderRadius: '4px',
        letterSpacing: '0.02em',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {meta.id} · {meta.titleBn}
    </span>
  );
}

function SectionBox({
  sectionId,
  guided,
  style,
  className,
  children,
}: {
  sectionId: string;
  guided: boolean;
  style?: React.CSSProperties;
  className?: string;
  children: React.ReactNode;
}) {
  const meta = SECTION_META_MAP.get(sectionId);
  const guideStyle: React.CSSProperties = guided
    ? {
        position: 'relative',
        outline: `1.5px dashed ${meta?.color ?? '#0f766e'}`,
        outlineOffset: '3px',
        borderRadius: '3px',
      }
    : {};

  return (
    <div data-tr21-section={sectionId} className={className} style={{ ...style, ...guideStyle }}>
      {guided && <SectionBadge sectionId={sectionId} />}
      {children}
    </div>
  );
}

function fs(basePx: number, dataFontSize?: number): string {
  const scale = (dataFontSize && Number.isFinite(dataFontSize) ? dataFontSize : 11) / 11;
  return `${Number((basePx * scale).toFixed(2))}px`;
}

function DraftWatermark({ fontFamilyCss }: { fontFamilyCss?: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 20,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontFamily: fontFamilyCss || "'NikoshBAN', 'Nikosh', 'Noto Sans Bengali', sans-serif",
          fontSize: '124px',
          fontWeight: 700,
          color: 'rgba(185, 28, 28, 0.14)',
          transform: 'rotate(-32deg)',
          letterSpacing: '0.08em',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        খসড়া
      </div>
    </div>
  );
}

function SmallCheckSquare() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '12px',
        height: '12px',
        border: '1px solid #000000',
        flexShrink: 0,
        backgroundColor: '#ffffff',
      }}
    />
  );
}

function renderClauseLines(text: string): React.ReactNode {
  const lines = text.split('\n');
  if (lines.length <= 1) return text;
  return lines.map((line, i) => {
    const trimmed = line.trim();
    const isSubClause = /^\([ক-ঙ]\)/.test(trimmed);
    return (
      <div
        key={i}
        style={{
          paddingLeft: isSubClause ? '34px' : '0px',
          marginTop: i === 0 ? '0px' : '2px',
        }}
      >
        {line}
      </div>
    );
  });
}

function PageFooter({
  leftText,
  pageNum,
  fontSize,
  pinToBottom = true,
}: {
  leftText: string;
  pageNum: 1 | 2;
  fontSize?: number;
  pinToBottom?: boolean;
}) {
  return (
    <div
      style={{
        marginTop: pinToBottom ? 'auto' : '10px',
        paddingTop: pinToBottom ? '10px' : '0px',
      }}
    >
      <div
        style={{
          borderTop: '1px solid #000000',
          paddingTop: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: fs(10.5, fontSize),
          fontFamily: 'inherit',
        }}
      >
        <span>{leftText}</span>
        <span>Page {pageNum} of 2</span>
      </div>
    </div>
  );
}

/* ============================================================================
 * PAGE 1 — SECTION 1 (P1-S1): শিরোনাম, মন্ত্রণালয়, দপ্তর ও মোবাইল নং
 * ============================================================================ */
function SectionP1Header({ data, guided }: { data: Tr21FormData; guided: boolean }) {
  return (
    <SectionBox sectionId="P1-S1" guided={guided}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <div style={{ width: '155px', fontSize: fs(10, data.fontSize), lineHeight: 1.35 }}>
          <div>টি.আর ফরম নং ২১</div>
          <div>(এস, আর ১৮৩ দ্রষ্টব্য)</div>
        </div>

        <div style={{ flex: 1, textAlign: 'center', lineHeight: 1.32 }}>
          <div style={{ fontSize: fs(14.5, data.fontSize), fontWeight: 700 }}>
            ক্রয়, সরবরাহ ও সেবা বাবদ ব্যয়ের বিল
          </div>
          {data.ministryName ? (
            <div style={{ fontSize: fs(12, data.fontSize), marginTop: '2px' }}>
              {data.ministryName}
            </div>
          ) : null}
          <div style={{ fontSize: fs(12, data.fontSize), marginTop: '1px' }}>{data.officeName}</div>
          {data.officeAddress ? (
            <div style={{ fontSize: fs(11.5, data.fontSize), marginTop: '1px' }}>
              {data.officeAddress}
            </div>
          ) : null}
        </div>

        <div
          style={{
            width: '155px',
            textAlign: 'right',
            fontSize: fs(10, data.fontSize),
            lineHeight: 1.35,
          }}
        >
          {data.officeMobileNoBn ? (
            <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
              মোবাইল নং: {data.officeMobileNoBn}
            </div>
          ) : null}
          {data.isDraft ? (
            <div style={{ marginTop: data.officeMobileNoBn ? '4px' : '0px' }}>
              <span
                style={{
                  border: '1px solid #991b1b',
                  color: '#991b1b',
                  padding: '1px 6px',
                  fontWeight: 700,
                }}
              >
                খসড়া (Draft)
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </SectionBox>
  );
}

/* ============================================================================
 * PAGE 1 — SECTION 2 (P1-S2): কোড নং (১-৪-৪-৪), টোকেন, তারিখ ও ভাউচার নং
 * ============================================================================ */
function SectionP1CodeAndVoucher({ data, guided }: { data: Tr21FormData; guided: boolean }) {
  return (
    <SectionBox sectionId="P1-S2" guided={guided} style={{ marginTop: '8px', marginBottom: '10px' }}>
      {/* Code No row with 1 - 4 - 4 - 4 digit boxes */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: fs(11, data.fontSize),
        }}
      >
        <span style={{ whiteSpace: 'nowrap', minWidth: '140px' }}>কোড নং</span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
          {data.institutionalCodeGroups.map((group, gIdx) => (
            <React.Fragment key={gIdx}>
              {gIdx > 0 && <span style={{ fontWeight: 600 }}>-</span>}
              <div style={{ display: 'inline-flex' }}>
                {group.map((digit, dIdx) => (
                  <span
                    key={dIdx}
                    style={{
                      width: '20px',
                      height: '20px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderTop: '1px solid #000000',
                      borderBottom: '1px solid #000000',
                      borderRight: '1px solid #000000',
                      borderLeft: dIdx === 0 ? '1px solid #000000' : 'none',
                      fontSize: fs(11, data.fontSize),
                      fontWeight: 500,
                      lineHeight: 1,
                    }}
                  >
                    {digit}
                  </span>
                ))}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Token No, Date, Voucher No, Bill Date */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '10px',
          marginTop: '8px',
          fontSize: fs(11, data.fontSize),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', flex: '0.95' }}>
          <span style={{ whiteSpace: 'nowrap' }}>টোকেন নং:</span>
          <span
            style={{
              flex: 1,
              borderBottom: '1px dotted #000000',
              lineHeight: 1.25,
              padding: '0 4px 1px',
              textAlign: 'center',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {data.tokenNoBn || '\u00A0'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', flex: '0.75' }}>
          <span style={{ whiteSpace: 'nowrap' }}>তারিখ:</span>
          <span
            style={{
              flex: 1,
              borderBottom: '1px dotted #000000',
              lineHeight: 1.25,
              paddingBottom: '1px',
            }}
          >
            {'\u00A0'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flex: '1.15' }}>
          <span style={{ whiteSpace: 'nowrap' }}>ভাউচার নং:</span>
          <span
            style={{
              flex: 1,
              borderBottom: '1px dotted #000000',
              lineHeight: 1.25,
              padding: '0 4px 1px',
              textAlign: 'center',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {data.voucherNoBn || '\u00A0'}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'flex-end',
            gap: '6px',
            flex: '0.9',
            whiteSpace: 'nowrap',
          }}
        >
          <span>তারিখ:</span>
          <span
            style={{
              flex: 1,
              borderBottom: '1px dotted #000000',
              lineHeight: 1.25,
              padding: '0 4px 1px',
              textAlign: 'center',
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            {data.billDateShortBn || '\u00A0'}
          </span>
        </div>
      </div>
    </SectionBox>
  );
}

/* ============================================================================
 * PAGE 1 — SECTIONS 3 & 4 (P1-S3, P1-S4): মূল বিলের ছক
 * ============================================================================ */
function SectionP1MainTable({
  data,
  supplierLine,
  guided,
}: {
  data: Tr21FormData;
  supplierLine: string;
  guided: boolean;
}) {
  const displayRows = data.displayRows?.length ? data.displayRows : data.items;
  const bodyRowsCount = 1 + Math.max(1, displayRows.length) + (supplierLine ? 1 : 0);
  const s3Color = SECTION_META_MAP.get('P1-S3')?.color ?? '#7c3aed';
  const s4Color = SECTION_META_MAP.get('P1-S4')?.color ?? '#b45309';

  return (
    <table className="tr21-table" style={{ fontSize: fs(11, data.fontSize), lineHeight: 1.38 }}>
      <colgroup>
        <col style={{ width: '17%' }} />
        <col style={{ width: '53%' }} />
        <col style={{ width: '21%' }} />
        <col style={{ width: '9%' }} />
      </colgroup>
      <thead>
        <tr>
          <th
            rowSpan={2}
            style={{
              padding: '5px 5px',
              textAlign: 'center',
              verticalAlign: 'middle',
              fontWeight: 600,
              position: guided ? 'relative' : undefined,
              boxShadow: guided ? `inset 0 2px 0 ${s3Color}` : undefined,
            }}
          >
            {guided && <SectionBadge sectionId="P1-S3" />}
            অর্থনৈতিক কোড
          </th>
          <th
            rowSpan={2}
            style={{
              padding: '5px 6px',
              textAlign: 'center',
              verticalAlign: 'middle',
              fontWeight: 600,
              boxShadow: guided ? `inset 0 2px 0 ${s3Color}` : undefined,
            }}
          >
            বিবরণ
          </th>
          <th
            colSpan={2}
            style={{
              padding: '3px 4px',
              textAlign: 'center',
              verticalAlign: 'middle',
              fontWeight: 600,
              boxShadow: guided ? `inset 0 2px 0 ${s3Color}` : undefined,
            }}
          >
            পরিমাণ
          </th>
        </tr>
        <tr>
          <th style={{ padding: '3px 4px', textAlign: 'center', fontWeight: 600 }}>টাকা</th>
          <th style={{ padding: '3px 4px', textAlign: 'center', fontWeight: 600 }}>পয়সা</th>
        </tr>
      </thead>

      {/* -------- P1-S3: বিবরণ (ডাইনামিক বরাদ্দ বিবরণ + ভাউচার/দ্রব্য তালিকা) ও মোট টাকা (ক) -------- */}
      <tbody
        data-tr21-section="P1-S3"
        style={guided ? { backgroundColor: 'rgba(124, 58, 237, 0.03)' } : undefined}
      >
        {/* Dynamic Intro Row */}
        <tr>
          <td
            rowSpan={bodyRowsCount}
            style={{
              padding: '8px 6px',
              textAlign: 'left',
              verticalAlign: 'top',
            }}
          >
            <div style={{ fontWeight: 600 }}>{data.economicCodeBn}</div>
            {data.headNameBn ? (
              <div style={{ marginTop: '2px', fontSize: fs(10.5, data.fontSize), lineHeight: 1.3 }}>
                {data.headNameBn}
              </div>
            ) : null}
          </td>
          <td
            style={{
              borderTop: '1px solid #000000',
              borderBottom: 'none',
              padding: '7px 8px 14px 8px',
              textAlign: 'justify',
              lineHeight: 1.45,
            }}
          >
            {data.introText}
          </td>
          <td
            style={{
              borderTop: '1px solid #000000',
              borderBottom: 'none',
              padding: '7px 8px 2px 6px',
            }}
          />
          <td
            style={{
              borderTop: '1px solid #000000',
              borderBottom: 'none',
              padding: '7px 4px 2px 4px',
            }}
          />
        </tr>

        {/* Expense Item Rows with dotted leader */}
        {displayRows.length > 0 ? (
          displayRows.map((item, idx) => {
            const isLastItem = idx === displayRows.length - 1 && !supplierLine;
            return (
              <tr key={idx}>
                <td
                  style={{
                    borderTop: 'none',
                    borderBottom: isLastItem ? '1px solid #000000' : 'none',
                    padding: isLastItem ? '2px 8px 16px 8px' : '2px 8px',
                    verticalAlign: 'top',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '2px',
                      paddingLeft: '14px',
                    }}
                  >
                    <span style={{ flex: '0 1 auto', minWidth: 0 }}>
                      {item.indexBn}) {item.description}
                    </span>
                    <span
                      aria-hidden="true"
                      style={{
                        flex: '1 0 16px',
                        minWidth: '16px',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        letterSpacing: '0.5px',
                        alignSelf: 'flex-end',
                      }}
                    >
                      ........................................................................................................................................
                    </span>
                  </div>
                </td>
                <td
                  style={{
                    borderTop: 'none',
                    borderBottom: isLastItem ? '1px solid #000000' : 'none',
                    padding: isLastItem ? '2px 8px 16px 6px' : '2px 8px 2px 6px',
                    textAlign: 'right',
                    verticalAlign: 'bottom',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.takaStr}
                </td>
                <td
                  style={{
                    borderTop: 'none',
                    borderBottom: isLastItem ? '1px solid #000000' : 'none',
                    padding: isLastItem ? '2px 4px 16px 4px' : '2px 4px',
                    textAlign: 'center',
                    verticalAlign: 'bottom',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.paisaStr}
                </td>
              </tr>
            );
          })
        ) : (
          <tr>
            <td
              style={{
                borderTop: 'none',
                borderBottom: supplierLine ? 'none' : '1px solid #000000',
                padding: supplierLine ? '2px 8px' : '2px 8px 16px 8px',
                verticalAlign: 'top',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '2px',
                  paddingLeft: '14px',
                }}
              >
                <span style={{ flex: '0 1 auto', minWidth: 0 }}>১) {data.purposeText}</span>
                <span
                  aria-hidden="true"
                  style={{
                    flex: '1 0 16px',
                    minWidth: '16px',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    letterSpacing: '0.5px',
                    alignSelf: 'flex-end',
                  }}
                >
                  ........................................................................................................................................
                </span>
              </div>
            </td>
            <td
              style={{
                borderTop: 'none',
                borderBottom: supplierLine ? 'none' : '1px solid #000000',
                padding: supplierLine ? '2px 8px 2px 6px' : '2px 8px 16px 6px',
                textAlign: 'right',
                whiteSpace: 'nowrap',
              }}
            >
              {data.gross.takaStr}
            </td>
            <td
              style={{
                borderTop: 'none',
                borderBottom: supplierLine ? 'none' : '1px solid #000000',
                padding: supplierLine ? '2px 4px' : '2px 4px 16px 4px',
                textAlign: 'center',
              }}
            >
              {data.gross.paisaStr}
            </td>
          </tr>
        )}

        {supplierLine && (
          <tr>
            <td
              style={{
                borderTop: 'none',
                borderBottom: '1px solid #000000',
                padding: '4px 8px 12px 8px',
                fontSize: fs(10.2, data.fontSize),
              }}
            >
              {supplierLine}
            </td>
            <td style={{ borderTop: 'none', borderBottom: '1px solid #000000' }} />
            <td style={{ borderTop: 'none', borderBottom: '1px solid #000000' }} />
          </tr>
        )}

        {/* Total Gross Row */}
        <tr>
          <td style={{ padding: '4px 6px' }} />
          <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>
            মোট টাকা (ক)
          </td>
          <td
            style={{
              padding: '4px 8px',
              textAlign: 'right',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {data.gross.takaStr}
          </td>
          <td
            style={{
              padding: '4px 4px',
              textAlign: 'center',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {data.gross.paisaStr}
          </td>
        </tr>
      </tbody>

      {/* -------- P1-S4: কর্তন ও পরিশোধ, প্রদেয় বিল ও নেট কথায় -------- */}
      <tbody
        data-tr21-section="P1-S4"
        style={guided ? { backgroundColor: 'rgba(180, 83, 9, 0.04)' } : undefined}
      >
        {/* Deductions Header */}
        <tr>
          <td
            colSpan={4}
            style={{
              padding: '4px 8px',
              fontWeight: 700,
              position: guided ? 'relative' : undefined,
              boxShadow: guided ? `inset 0 2px 0 ${s4Color}` : undefined,
            }}
          >
            {guided && <SectionBadge sectionId="P1-S4" />}
            কর্তন ও পরিশোধ
          </td>
        </tr>

        {/* Deduction Lines with Checkbox + Code */}
        {data.deductions.map((d) => (
          <tr key={d.id}>
            <td style={{ padding: '4px 6px', verticalAlign: 'middle' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <SmallCheckSquare />
                <span>{d.codeBn}</span>
              </div>
            </td>
            <td style={{ padding: '4px 8px', verticalAlign: 'middle' }}>{d.label}</td>
            <td
              style={{
                padding: '4px 8px',
                textAlign: 'right',
                verticalAlign: 'middle',
                whiteSpace: 'nowrap',
              }}
            >
              {d.takaStr}
            </td>
            <td
              style={{
                padding: '4px 4px',
                textAlign: 'center',
                verticalAlign: 'middle',
                whiteSpace: 'nowrap',
              }}
            >
              {d.paisaStr}
            </td>
          </tr>
        ))}

        {/* Total Deduction Row */}
        <tr>
          <td style={{ padding: '4px 6px' }} />
          <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 500 }}>
            কর্তন ও পরিশোধ বাবদ মোট আদায় (খ):
          </td>
          <td
            style={{
              padding: '4px 8px',
              textAlign: 'right',
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            {data.totalDeduction.takaStr}
          </td>
          <td
            style={{
              padding: '4px 4px',
              textAlign: 'center',
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            {data.totalDeduction.paisaStr}
          </td>
        </tr>

        {/* Net Payable Row */}
        <tr>
          <td style={{ padding: '4px 6px', verticalAlign: 'middle' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <SmallCheckSquare />
              <span>{data.netPayableCodeBn}</span>
            </div>
          </td>
          <td style={{ padding: '4px 8px', verticalAlign: 'middle' }}>প্রদেয় বিল (ক-খ)</td>
          <td
            style={{
              padding: '4px 8px',
              textAlign: 'right',
              verticalAlign: 'middle',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {data.netPayable.takaStr}
          </td>
          <td
            style={{
              padding: '4px 4px',
              textAlign: 'center',
              verticalAlign: 'middle',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {data.netPayable.paisaStr}
          </td>
        </tr>

        {/* Net Bill in words Row */}
        <tr>
          <td
            colSpan={4}
            style={{
              padding: '5px 8px',
              boxShadow: guided ? `inset 0 -2px 0 ${s4Color}` : undefined,
            }}
          >
            <span>নেট বিল (কথায়): </span>
            <span style={{ fontWeight: 500 }}>{data.netPayableInWords}।</span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function isPayeeClauseItem(clause: Tr21FormData['page1Clauses'][number]): boolean {
  return (
    clause.id === '7' ||
    clause.id === '12' ||
    clause.text.includes('যাহার নামে ইস্যু করা হইবে') ||
    clause.text.includes('যার নামে চেক ইস্যু করা হবে')
  );
}

function renderCertificationClauseItem(
  clause: Tr21FormData['page1Clauses'][number],
  payeeText: string
): React.ReactNode {
  if (isPayeeClauseItem(clause)) {
    const colonIdx = clause.text.indexOf(':');
    const prefix = colonIdx >= 0 ? clause.text.slice(0, colonIdx + 1) : clause.text;
    const payeeVal =
      payeeText || (colonIdx >= 0 ? clause.text.slice(colonIdx + 1).trim() : '');
    return (
      <div key={clause.id} style={{ marginTop: '4px', marginBottom: '6px' }}>
        <span>
          {clause.numberBn}। {prefix}{' '}
        </span>
        {payeeVal ? (
          <span style={{ fontWeight: 600 }}>{payeeVal}</span>
        ) : (
          <span>........................................................</span>
        )}
      </div>
    );
  }

  const lines = clause.text.split('\n');
  if (lines.length <= 1) {
    return (
      <div key={clause.id} style={{ marginBottom: '5px', textAlign: 'justify' }}>
        {clause.numberBn}। {clause.text}
      </div>
    );
  }

  return (
    <div key={clause.id} style={{ marginBottom: '5px', textAlign: 'justify' }}>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          {renderClauseLines(i === 0 ? `${clause.numberBn}। ${line}` : line)}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ============================================================================
 * PAGE 1 — SECTION 5 (P1-S5): পাতা-১ প্রত্যয়নসমূহ
 * ============================================================================ */
function SectionP1Clauses({ data, guided }: { data: Tr21FormData; guided: boolean }) {
  if (data.page1Clauses.length === 0 && !guided) {
    return null;
  }
  return (
    <SectionBox
      sectionId="P1-S5"
      guided={guided}
      style={{ marginTop: '10px', fontSize: fs(10.6, data.fontSize), lineHeight: 1.4 }}
    >
      {data.page1Clauses.length === 0 ? (
        <div style={{ color: '#6b7280', fontStyle: 'italic', padding: '4px 0' }}>
          (পাতা ১-এ কোনো প্রত্যয়ন ধারা নির্ধারিত নেই)
        </div>
      ) : (
        data.page1Clauses.map((clause) => renderCertificationClauseItem(clause, data.payeeText))
      )}
    </SectionBox>
  );
}

/* ============================================================================
 * PAGE 2 — SECTION 1 (P2-S1): পাতা-২ প্রত্যয়ন ও প্রাপক
 * ============================================================================ */
function SectionP2Clauses({ data, guided }: { data: Tr21FormData; guided: boolean }) {
  if (data.page2Clauses.length === 0 && !guided) {
    return null;
  }
  return (
    <SectionBox
      sectionId="P2-S1"
      guided={guided}
      style={{ fontSize: fs(10.8, data.fontSize), lineHeight: 1.44 }}
    >
      {data.page2Clauses.length === 0 ? (
        <div style={{ color: '#6b7280', fontStyle: 'italic', padding: '4px 0' }}>
          (পাতা ২-এ কোনো প্রত্যয়ন ধারা নির্ধারিত নেই)
        </div>
      ) : (
        data.page2Clauses.map((clause) => renderCertificationClauseItem(clause, data.payeeText))
      )}
    </SectionBox>
  );
}

/* ============================================================================
 * PAGE 2 — SECTION 2 (P2-S2): কর্মকর্তাদের স্বাক্ষর ও সিল ব্লক
 * ============================================================================ */
function SectionP2Signatures({ data, guided }: { data: Tr21FormData; guided: boolean }) {
  return (
    <SectionBox
      sectionId="P2-S2"
      guided={guided}
      className="tr21-avoid-break"
      style={{ marginTop: '14px', fontSize: fs(10.8, data.fontSize), lineHeight: 1.55 }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '34px',
        }}
      >
        {/* Left: Controlling / Countersigning Officer */}
        <div>
          <div style={{ fontWeight: 600 }}>* নিয়ন্ত্রণকারী/প্রতিস্বাক্ষরকারী কর্মকর্তার স্বাক্ষর</div>
          <div>......................................................................</div>
          <div>নাম..................................................................</div>
          <div>পদবী................................................................</div>
          <div style={{ height: '14px' }} />
          <div>সীল..................................................................</div>
          <div>স্থান................................................................</div>
          <div>তারিখ..............................................................</div>
        </div>

        {/* Right: Drawing & Disbursing Officer (DDO) */}
        <div>
          <div>বুঝিয়া পাইয়াছি ...................................................</div>
          <div>আয়ন ব্যয়ন কর্মকর্তার স্বাক্ষর.....................................</div>
          <div>নাম...................................................................</div>
          <div>পদবী.................................................................</div>
          <div style={{ height: '14px' }} />
          <div>সীল...................................................................</div>
          <div>
            স্থান{' '}
            {data.placeName ? (
              <span style={{ borderBottom: '1px dotted #000000', padding: '0 6px' }}>
                {data.placeName}
              </span>
            ) : (
              '..................................................................'
            )}
          </div>
          <div>তারিখ...............................................................</div>
        </div>
      </div>
    </SectionBox>
  );
}

/* ============================================================================
 * PAGE 2 — SECTION 3 (P2-S3): বরাদ্দের হিসাব ও ব্যয়ের হিসাব (২ কলাম টেবিল)
 * ============================================================================ */
function SectionP2AccountingTables({ data, guided }: { data: Tr21FormData; guided: boolean }) {
  return (
    <SectionBox
      sectionId="P2-S3"
      guided={guided}
      className="tr21-avoid-break"
      style={{ marginTop: '16px' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '24px',
        }}
      >
        {/* Left Table: বরাদ্দের হিসাব | টাকা */}
        <table className="tr21-table" style={{ fontSize: fs(10.6, data.fontSize), lineHeight: 1.35 }}>
          <colgroup>
            <col style={{ width: '74%' }} />
            <col style={{ width: '26%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>
                বরাদ্দের হিসাব
              </th>
              <th style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 600 }}>টাকা</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '3.5px 6px' }}>১। শেষ বিলের টাকার অংক</td>
              <td style={{ padding: '3.5px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {data.allocationSummary.lastBillAmount.takaStr}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '3.5px 6px' }}>
                ২। এ যাবত অতিরিক্ত বরাদ্দ (পত্র নং{' '}
                {data.allocationSummary.additionalRefNo || '........'})
              </td>
              <td style={{ padding: '3.5px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {data.allocationSummary.additionalAllocation.takaStr}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '3.5px 6px' }}>
                ৩। এ যাবত যে অংকের বরাদ্দ কমানো হইয়াছে। (পত্র নং{' '}
                {data.allocationSummary.reducedRefNo || '........'})
              </td>
              <td style={{ padding: '3.5px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {data.allocationSummary.reducedAllocation.takaStr}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '3.5px 6px', fontWeight: 500 }}>৪। নীট মোট</td>
              <td
                style={{
                  padding: '3.5px 6px',
                  textAlign: 'right',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {data.allocationSummary.netTotalAllocation.takaStr}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Right Table: ব্যয়ের হিসাব | টাকা */}
        <table className="tr21-table" style={{ fontSize: fs(10.6, data.fontSize), lineHeight: 1.35 }}>
          <colgroup>
            <col style={{ width: '74%' }} />
            <col style={{ width: '26%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>
                ব্যয়ের হিসাব
              </th>
              <th style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 600 }}>টাকা</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '3.5px 6px' }}>গত বিলের মোট জের (+)</td>
              <td style={{ padding: '3.5px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {data.expenseSummary.previousTotal.takaStr}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '3.5px 6px' }}>এই বিলের মোট (+)</td>
              <td style={{ padding: '3.5px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {data.expenseSummary.currentBillTotal.takaStr}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '3.5px 6px' }}>সংযুক্ত পূর্তকর্মের বিলের টাকা</td>
              <td style={{ padding: '3.5px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {data.expenseSummary.attachedWorksAmount.takaStr}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '3.5px 6px', fontWeight: 500 }}>
                মোট (পরবর্তী বিলের জের টানিয়া)
              </td>
              <td
                style={{
                  padding: '3.5px 6px',
                  textAlign: 'right',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {data.expenseSummary.cumulativeTotal.takaStr}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionBox>
  );
}

/* ============================================================================
 * PAGE 2 — SECTION 4 (P2-S4): হিসাবরক্ষণ অফিসে ব্যবহারের জন্য ও চেক প্রদান
 * ============================================================================ */
function SectionP2AuditOffice({
  guided,
  fontSize,
}: {
  guided: boolean;
  fontSize?: number;
}) {
  return (
    <SectionBox
      sectionId="P2-S4"
      guided={guided}
      className="tr21-avoid-break"
      style={{ marginTop: '6px', fontSize: fs(10.8, fontSize), lineHeight: 1.45 }}
    >
      <div
        style={{
          textAlign: 'center',
          fontWeight: 700,
          borderBottom: '1px solid #000000',
          paddingBottom: '2px',
          marginBottom: '8px',
        }}
      >
        হিসাবরক্ষণ অফিসে ব্যবহারের জন্য
      </div>

      <div>
        প্রদানের জন্য পাস করা হইল টাকা .................................. কথায়{' '}
        .....................................................................
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '24px',
          marginTop: '48px',
        }}
      >
        {/* Auditor */}
        <div>
          <div style={{ fontWeight: 700 }}>অডিটর (স্বাক্ষর)</div>
          <div>নাম...................................</div>
          <div>তাং ..................................</div>
        </div>

        {/* Super */}
        <div>
          <div>সুপার (স্বাক্ষর)</div>
          <div>নাম...................................</div>
          <div>তাং...................................</div>
          <div>চেক নং...............................</div>
        </div>

        {/* Accounts Officer + Cheque Issuer */}
        <div>
          <div style={{ fontWeight: 700 }}>হিসাবরক্ষণ অফিসার (স্বাক্ষর)</div>
          <div>নাম...................................</div>
          <div>তাং...................................</div>

          <div style={{ marginTop: '36px' }}>
            <div>চেক প্রদানকারীর স্বাক্ষর...............</div>
            <div>নাম...................................</div>
          </div>
        </div>
      </div>
    </SectionBox>
  );
}

/* ============================================================================
 * PAGE 2 — SECTION 5 (P2-S5): বিঃ দ্রঃ ও ব্যক্তিগত দায়বদ্ধতা নোট
 * ============================================================================ */
function SectionP2LiabilityNote({
  guided,
  fontSize,
}: {
  guided: boolean;
  fontSize?: number;
}) {
  return (
    <SectionBox
      sectionId="P2-S5"
      guided={guided}
      className="tr21-avoid-break"
      style={{
        borderTop: '1px solid #000000',
        paddingTop: '6px',
        fontSize: fs(10.2, fontSize),
        lineHeight: 1.4,
      }}
    >
      <div>* কেবল মাত্র প্রযোজ্য ক্ষেত্রে।</div>
      <div style={{ textAlign: 'justify', marginTop: '2px' }}>
        বিঃ দ্রঃ ইহা স্পষ্টভাবে রাখিতে হইবে যে, বরাদ্দের অতিরিক্ত ব্যয়ের জন্য আয়ন কর্মকর্তা ব্যক্তিগতভাবে দায়ী থাকিবেন। বরাদ্দের অতিরিক্ত ব্যয়ের বিপরীতে যদি তিনি অতিরিক্ত বরাদ্দ মঞ্জুর করাইতে না পারেন, তবে অতিরিক্ত ব্যয়িত অর্থ তাহার ব্যক্তিগত ভাতাদি হইতে আদায় করা হইবে।
      </div>
    </SectionBox>
  );
}

/* ============================================================================
 * MAIN FORM COMPONENT (Page 1 + Page 2)
 * ============================================================================ */
export const BillForm: React.FC<BillFormProps> = ({
  data,
  className = '',
  showSectionGuides = false,
}) => {
  const supplierParts: string[] = [];
  if (data.supplier?.name?.trim()) supplierParts.push(`সরবরাহকারী: ${data.supplier.name.trim()}`);
  if (data.supplier?.address?.trim()) supplierParts.push(`ঠিকানা: ${data.supplier.address.trim()}`);
  if (data.supplier?.tinBin?.trim()) supplierParts.push(`টিআইএন/বিআইএন: ${data.supplier.tinBin.trim()}`);
  const supplierLine = supplierParts.join(' · ');

  return (
    <div
      className={`tr21-document ${className}`}
      style={{ fontFamily: data.fontFamilyCss || undefined }}
      data-testid="tr21-bill-form"
    >
      {/* ======================== PAGE 1 ======================== */}
      <section className="tr21-page tr21-page-1">
        {data.isDraft && <DraftWatermark fontFamilyCss={data.fontFamilyCss} />}

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <SectionP1Header data={data} guided={showSectionGuides} />
          <SectionP1CodeAndVoucher data={data} guided={showSectionGuides} />
          <SectionP1MainTable
            data={data}
            supplierLine={supplierLine}
            guided={showSectionGuides}
          />
          <SectionP1Clauses data={data} guided={showSectionGuides} />
          <PageFooter leftText={data.footerLeftText} pageNum={1} fontSize={data.fontSize} />
        </div>
      </section>

      {/* MS Word-style Page Break Divider (screen preview only) */}
      <div className="tr21-page-divider" data-no-export="true" aria-hidden="true">
        <span className="tr21-page-divider-line" />
        <span>পাতা ১ সমাপ্ত · পাতা ২ শুরু</span>
        <span className="tr21-page-divider-line" />
      </div>

      {/* ======================== PAGE 2 ======================== */}
      <section className="tr21-page tr21-page-2">
        {data.isDraft && <DraftWatermark fontFamilyCss={data.fontFamilyCss} />}

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <SectionP2Clauses data={data} guided={showSectionGuides} />
          <SectionP2Signatures data={data} guided={showSectionGuides} />
          <SectionP2AccountingTables data={data} guided={showSectionGuides} />
          <SectionP2AuditOffice guided={showSectionGuides} fontSize={data.fontSize} />
          <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
            <SectionP2LiabilityNote guided={showSectionGuides} fontSize={data.fontSize} />
            <PageFooter
              leftText={data.footerLeftText}
              pageNum={2}
              fontSize={data.fontSize}
              pinToBottom={false}
            />
          </div>
        </div>
      </section>
    </div>
  );
};
