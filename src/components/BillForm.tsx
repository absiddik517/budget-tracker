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
    titleBn: 'শিরোনাম ও দপ্তরের নাম',
    summaryBn: 'টি.আর. ফরম নং-২১, এস.আর ১৮৩, শিরোনাম, দপ্তরের নাম ও খসড়া ব্যাজ',
    color: '#0f766e',
  },
  {
    id: 'P1-S2',
    page: 1,
    titleBn: 'প্রাতিষ্ঠানিক কোড, টোকেন ও ভাউচার',
    summaryBn: '১৩ ঘরের প্রাতিষ্ঠানিক কোড, টোকেন নং, তারিখ, ভাউচার নং ও অর্থবছর',
    color: '#0369a1',
  },
  {
    id: 'P1-S3',
    page: 1,
    titleBn: 'মূল ছক (ক): ব্যয়ের বিবরণ ও মোট টাকা',
    summaryBn: 'অর্থনৈতিক কোড, ভূমিকা ও সরবরাহকারী তথ্য, খরচ আইটেম তালিকা এবং মোট টাকা (ক)',
    color: '#7c3aed',
  },
  {
    id: 'P1-S4',
    page: 1,
    titleBn: 'মূল ছক (খ): কর্তন, প্রদেয় বিল ও কথায়',
    summaryBn: 'কর্তন ও পরিশোধ (ভ্যাট/আয়কর), ২টি খালি সারি, মোট আদায় (খ), প্রদেয় বিল (ক-খ) ও কথায়',
    color: '#b45309',
  },
  {
    id: 'P1-S5',
    page: 1,
    titleBn: 'পাতা-১ প্রত্যয়ন ও শর্তাবলি (১–১০)',
    summaryBn: 'বিধি অনুযায়ী ১ থেকে ১০ নম্বর প্রত্যয়ন অনুচ্ছেদসমূহ',
    color: '#be123c',
  },
  {
    id: 'P2-S1',
    page: 2,
    titleBn: 'পাতা-২ শর্তাবলি ও চেক প্রাপক (১১–১২)',
    summaryBn: '১১ নম্বর অনুচ্ছেদ ও ১২ নম্বরে যার নামে চেক ইস্যু হবে',
    color: '#0f766e',
  },
  {
    id: 'P2-S2',
    page: 2,
    titleBn: 'কর্মকর্তাদের স্বাক্ষর ও সিল',
    summaryBn: 'বামে নিয়ন্ত্রণকারী/প্রতিস্বাক্ষরকারী এবং ডানে বুঝে পেয়েছি ও আয়ন কর্মকর্তা (DDO)',
    color: '#0369a1',
  },
  {
    id: 'P2-S3',
    page: 2,
    titleBn: 'বরাদ্দ ও ব্যয়ের হিসাব টেবিল',
    summaryBn: 'পাশাপাশি দুই টেবিল: বরাদ্দের হিসাব (বামে) ও ব্যয়ের হিসাব (ডানে)',
    color: '#7c3aed',
  },
  {
    id: 'P2-S4',
    page: 2,
    titleBn: 'হিসাবরক্ষণ অফিস ও চেক প্রদান',
    summaryBn: 'পাস করা টাকার লাইন, অডিটর/সুপার/অ্যাকাউন্টস অফিসার ও চেক প্রদানকারীর স্বাক্ষর',
    color: '#b45309',
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
    <div
      data-tr21-section={sectionId}
      className={className}
      style={{ ...style, ...guideStyle }}
    >
      {guided && <SectionBadge sectionId={sectionId} />}
      {children}
    </div>
  );
}

function DraftWatermark() {
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
          fontFamily: "'NikoshBAN', 'Nikosh', 'Noto Sans Bengali', sans-serif",
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
          paddingLeft: isSubClause ? '16px' : '0px',
          marginTop: i === 0 ? '0px' : '1px',
        }}
      >
        {line}
      </div>
    );
  });
}

/* ============================================================================
 * PAGE 1 — SECTION 1 (P1-S1): শিরোনাম ও দপ্তরের নাম
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
        <div style={{ width: '145px', fontSize: '9.5px', lineHeight: 1.3 }}>
          <div>টি.আর.ফরম নং-২১</div>
          <div>(এস.আর ১৮৩ দ্রষ্টব্য)</div>
        </div>

        <div style={{ flex: 1, textAlign: 'center', lineHeight: 1.3 }}>
          <div style={{ fontSize: '15.5px', fontWeight: 700 }}>
            ক্রয়, সরবরাহ ও সেবা বাবদ ব্যয়ের বিল
          </div>
          <div style={{ fontSize: '12.5px', marginTop: '2px' }}>
            দপ্তর ঃ {data.officeName}
          </div>
        </div>

        <div style={{ width: '115px', textAlign: 'right', fontSize: '9.5px' }}>
          {data.isDraft ? (
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
          ) : null}
        </div>
      </div>
    </SectionBox>
  );
}

/* ============================================================================
 * PAGE 1 — SECTION 2 (P1-S2): প্রাতিষ্ঠানিক কোড, টোকেন ও ভাউচার তথ্য
 * ============================================================================ */
function SectionP1CodeAndVoucher({ data, guided }: { data: Tr21FormData; guided: boolean }) {
  return (
    <SectionBox sectionId="P1-S2" guided={guided} style={{ marginTop: '8px', marginBottom: '6px' }}>
      {/* Institutional / Operation Code Boxes + Token + Date */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          fontSize: '11px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ whiteSpace: 'nowrap' }}>প্রাতিষ্ঠানিক / অপারেশন কোড *</span>
          <div
            style={{
              display: 'inline-flex',
              borderCollapse: 'collapse',
            }}
          >
            {data.institutionalCodeBoxes.map((digit, idx) => (
              <span
                key={idx}
                style={{
                  width: '18px',
                  height: '20px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderTop: '1px solid #000000',
                  borderBottom: '1px solid #000000',
                  borderRight: '1px solid #000000',
                  borderLeft: idx === 0 ? '1px solid #000000' : 'none',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  lineHeight: 1,
                }}
              >
                {digit}
              </span>
            ))}
          </div>
        </div>

        <div style={{ whiteSpace: 'nowrap' }}>
          টোকেন নং{' '}
          {data.tokenNoBn ? (
            <span style={{ fontWeight: 600, borderBottom: '1px dotted #000', padding: '0 4px' }}>
              {data.tokenNoBn}
            </span>
          ) : null}
        </div>

        <div style={{ whiteSpace: 'nowrap', minWidth: '72px', textAlign: 'right' }}>তারিখ</div>
      </div>

      {/* Voucher No & Bill Date */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '4px',
          fontSize: '11.5px',
        }}
      >
        <div>
          <span>ভাউচার নং - </span>
          <span style={{ display: 'inline-block', minWidth: '58px', fontWeight: 600 }}>
            {data.voucherNoBn || ''}
          </span>
          <span>({data.fyShortBn})</span>
        </div>

        <div>
          <span>তারিখ - </span>
          <span style={{ fontWeight: 500 }}>{data.billDateShortBn}</span>
        </div>
      </div>
    </SectionBox>
  );
}

/* ============================================================================
 * PAGE 1 — SECTIONS 3 & 4 (P1-S3, P1-S4): মূল বিলের ছক
 *   P1-S3: হেডার + অর্থনৈতিক কোড + ভূমিকা/সরবরাহকারী + আইটেম তালিকা + মোট টাকা (ক)
 *   P1-S4: কর্তন ও পরিশোধ + ২ খালি সারি + মোট আদায় (খ) + প্রদেয় বিল (ক-খ) + কথায়
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
  const itemCount = Math.max(1, data.items.length);
  const s3Color = SECTION_META_MAP.get('P1-S3')?.color ?? '#7c3aed';
  const s4Color = SECTION_META_MAP.get('P1-S4')?.color ?? '#b45309';

  return (
    <table className="tr21-table" style={{ fontSize: '11.3px', lineHeight: 1.38 }}>
      <colgroup>
        <col style={{ width: '16%' }} />
        <col style={{ width: '56%' }} />
        <col style={{ width: '19%' }} />
        <col style={{ width: '9%' }} />
      </colgroup>
      <thead>
        <tr>
          <th
            style={{
              padding: '4px 5px',
              textAlign: 'center',
              fontWeight: 700,
              position: guided ? 'relative' : undefined,
              boxShadow: guided ? `inset 0 2px 0 ${s3Color}` : undefined,
            }}
          >
            {guided && <SectionBadge sectionId="P1-S3" />}
            অর্থনৈতিক কোড
          </th>
          <th
            style={{
              padding: '4px 6px',
              textAlign: 'center',
              fontWeight: 700,
              boxShadow: guided ? `inset 0 2px 0 ${s3Color}` : undefined,
            }}
          >
            বিবরণ
          </th>
          <th
            style={{
              padding: '4px 5px',
              textAlign: 'center',
              fontWeight: 700,
              boxShadow: guided ? `inset 0 2px 0 ${s3Color}` : undefined,
            }}
          >
            টাকার পরিমাণ
          </th>
          <th
            style={{
              padding: '4px 4px',
              textAlign: 'center',
              fontWeight: 700,
              boxShadow: guided ? `inset 0 2px 0 ${s3Color}` : undefined,
            }}
          >
            পয়সা
          </th>
        </tr>
      </thead>

      {/* -------- P1-S3: ব্যয়ের বিবরণ ও মোট টাকা (ক) -------- */}
      <tbody
        data-tr21-section="P1-S3"
        style={guided ? { backgroundColor: 'rgba(124, 58, 237, 0.03)' } : undefined}
      >
        {/* Intro narrative row */}
        <tr>
          <td
            rowSpan={itemCount + 1}
            style={{
              padding: '8px 4px',
              textAlign: 'center',
              verticalAlign: 'middle',
              fontSize: '12px',
              fontWeight: 500,
            }}
          >
            {data.economicCodeBn}
          </td>
          <td
            style={{
              padding: '6px 8px 4px 8px',
              borderBottom: 'none',
              textAlign: 'justify',
            }}
          >
            <div>{data.introText}</div>
            {supplierLine && (
              <div style={{ marginTop: '3px', fontSize: '10.8px' }}>{supplierLine}</div>
            )}
          </td>
          <td style={{ borderBottom: 'none', padding: '4px 6px' }} />
          <td style={{ borderBottom: 'none', padding: '4px 4px' }} />
        </tr>

        {/* Itemized Expense rows */}
        {data.items.length > 0 ? (
          data.items.map((item, idx) => (
            <tr key={idx}>
              <td
                style={{
                  borderTop: 'none',
                  borderBottom: idx === data.items.length - 1 ? '1px solid #000000' : 'none',
                  padding:
                    idx === data.items.length - 1 ? '3px 8px 8px 16px' : '3px 8px 3px 16px',
                }}
              >
                <span>
                  {item.indexBn}) {item.description}
                </span>
              </td>
              <td
                style={{
                  borderTop: 'none',
                  borderBottom: idx === data.items.length - 1 ? '1px solid #000000' : 'none',
                  padding: '3px 6px',
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
                  borderBottom: idx === data.items.length - 1 ? '1px solid #000000' : 'none',
                  padding: '3px 4px',
                  textAlign: 'center',
                  verticalAlign: 'bottom',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.paisaStr}
              </td>
            </tr>
          ))
        ) : (
          <tr>
            <td style={{ borderTop: 'none', padding: '6px 8px 8px 16px' }}>&nbsp;</td>
            <td style={{ borderTop: 'none', padding: '6px', textAlign: 'right' }}>
              {data.gross.takaStr}
            </td>
            <td style={{ borderTop: 'none', padding: '6px 4px', textAlign: 'center' }}>
              {data.gross.paisaStr}
            </td>
          </tr>
        )}

        {/* Total Gross Row */}
        <tr>
          <td style={{ padding: '4px 6px' }} />
          <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700 }}>
            মোট টাকা (ক)
          </td>
          <td
            style={{
              padding: '4px 6px',
              textAlign: 'right',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {data.gross.takaStr}
          </td>
          <td
            style={{
              padding: '4px 4px',
              textAlign: 'center',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {data.gross.paisaStr}
          </td>
        </tr>
      </tbody>

      {/* -------- P1-S4: কর্তন, প্রদেয় বিল ও কথায় -------- */}
      <tbody
        data-tr21-section="P1-S4"
        style={guided ? { backgroundColor: 'rgba(180, 83, 9, 0.04)' } : undefined}
      >
        {/* Deductions Header */}
        <tr>
          <td
            colSpan={4}
            style={{
              padding: '3px 8px',
              fontWeight: 700,
              position: guided ? 'relative' : undefined,
              boxShadow: guided ? `inset 0 2px 0 ${s4Color}` : undefined,
            }}
          >
            {guided && <SectionBadge sectionId="P1-S4" />}
            কর্তন ও পরিশোধ
          </td>
        </tr>

        {/* Deduction Lines */}
        {data.deductions.map((d) => (
          <tr key={d.id}>
            <td style={{ padding: '3px 6px', textAlign: 'left' }}>{d.codeBn}</td>
            <td style={{ padding: '3px 8px' }}>{d.label}</td>
            <td style={{ padding: '3px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
              {d.takaStr}
            </td>
            <td style={{ padding: '3px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>
              {d.paisaStr}
            </td>
          </tr>
        ))}

        {/* Blank Rows matching official TR 21 form */}
        {Array.from({ length: data.blankDeductionRowsCount }).map((_, idx) => (
          <tr key={`blank-${idx}`}>
            <td style={{ height: '20px', padding: '2px 6px' }}>&nbsp;</td>
            <td style={{ height: '20px', padding: '2px 8px' }}>&nbsp;</td>
            <td style={{ height: '20px', padding: '2px 6px' }}>&nbsp;</td>
            <td style={{ height: '20px', padding: '2px 4px' }}>&nbsp;</td>
          </tr>
        ))}

        {/* Total Deduction Row */}
        <tr>
          <td style={{ padding: '4px 6px' }} />
          <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>
            কর্তন ও পরিশোধ বাবদ মোট আদায় (খ)
          </td>
          <td
            style={{
              padding: '4px 6px',
              textAlign: 'right',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {data.totalDeduction.takaStr}
          </td>
          <td
            style={{
              padding: '4px 4px',
              textAlign: 'center',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {data.totalDeduction.paisaStr}
          </td>
        </tr>

        {/* Net Payable Row */}
        <tr>
          <td style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>
            {data.netPayableCodeBn}
          </td>
          <td style={{ padding: '4px 8px', fontWeight: 700 }}>প্রদেয় বিল (ক-খ)</td>
          <td
            style={{
              padding: '4px 6px',
              textAlign: 'right',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {data.netPayable.takaStr}
          </td>
          <td
            style={{
              padding: '4px 4px',
              textAlign: 'center',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {data.netPayable.paisaStr}
          </td>
        </tr>

        {/* Amount in words Row */}
        <tr>
          <td
            colSpan={4}
            style={{
              padding: '4px 8px',
              boxShadow: guided ? `inset 0 -2px 0 ${s4Color}` : undefined,
            }}
          >
            <span>টাকা (কথায়): </span>
            <span style={{ fontWeight: 500 }}>{data.netPayableInWords}।</span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/* ============================================================================
 * PAGE 1 — SECTION 5 (P1-S5): পাতা-১ প্রত্যয়ন ও শর্তাবলি (১–১০)
 * ============================================================================ */
function SectionP1Clauses({ data, guided }: { data: Tr21FormData; guided: boolean }) {
  return (
    <SectionBox
      sectionId="P1-S5"
      guided={guided}
      style={{ marginTop: '10px', fontSize: '10.6px', lineHeight: 1.34 }}
    >
      {data.page1Clauses.map((clause) => (
        <div
          key={clause.id}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            marginBottom: '4px',
            textAlign: 'justify',
          }}
        >
          <span style={{ minWidth: '20px', textAlign: 'right', flexShrink: 0 }}>
            {clause.numberBn}.
          </span>
          <div style={{ flex: 1 }}>{renderClauseLines(clause.text)}</div>
        </div>
      ))}
    </SectionBox>
  );
}

/* ============================================================================
 * PAGE 2 — SECTION 1 (P2-S1): পাতা-২ শর্তাবলি ও চেক প্রাপক (১১–১২)
 * ============================================================================ */
function SectionP2Clauses({ data, guided }: { data: Tr21FormData; guided: boolean }) {
  return (
    <SectionBox sectionId="P2-S1" guided={guided}>
      {data.page2Clauses.map((clause) => {
        const isPayeeClause =
          clause.id === '12' || clause.text.includes('যার নামে চেক ইস্যু করা হবে');
        if (isPayeeClause) {
          const colonIdx = clause.text.indexOf(':');
          const prefix = colonIdx >= 0 ? clause.text.slice(0, colonIdx + 1) : clause.text;
          const payeeVal =
            data.payeeText || (colonIdx >= 0 ? clause.text.slice(colonIdx + 1).trim() : '');
          return (
            <div
              key={clause.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                marginTop: '6px',
                marginBottom: '8px',
              }}
            >
              <span style={{ minWidth: '20px', textAlign: 'right', flexShrink: 0 }}>
                {clause.numberBn}.
              </span>
              <div style={{ flex: 1 }}>
                <span>{prefix} </span>
                {payeeVal ? (
                  <strong style={{ textDecoration: 'underline', fontWeight: 700 }}>
                    {payeeVal}।
                  </strong>
                ) : (
                  <span>........................................................</span>
                )}
              </div>
            </div>
          );
        }

        return (
          <div
            key={clause.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              marginBottom: '6px',
              textAlign: 'justify',
            }}
          >
            <span style={{ minWidth: '20px', textAlign: 'right', flexShrink: 0 }}>
              {clause.numberBn}.
            </span>
            <div style={{ flex: 1 }}>{renderClauseLines(clause.text)}</div>
          </div>
        );
      })}
    </SectionBox>
  );
}

/* ============================================================================
 * PAGE 2 — SECTION 2 (P2-S2): কর্মকর্তাদের স্বাক্ষর ও সিল
 * ============================================================================ */
function SectionP2Signatures({ data, guided }: { data: Tr21FormData; guided: boolean }) {
  return (
    <SectionBox
      sectionId="P2-S2"
      guided={guided}
      className="tr21-avoid-break"
      style={{ marginTop: '10px', fontSize: '11.2px' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '32px',
        }}
      >
        {/* Left: Controlling / Countersigning Officer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div>* নিয়ন্ত্রণকারী/প্রতিস্বাক্ষরকারী কর্মকর্তার স্বাক্ষর</div>
          <div style={{ height: '18px' }} />
          <div>নাম ....................................... পদবি ......................</div>
          <div style={{ marginTop: '16px' }}>সিল</div>
          <div style={{ marginTop: '12px' }}>
            স্থান ................................. তারিখ ..................
          </div>
        </div>

        {/* Right: Drawing & Disbursing Officer (DDO) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div>বুঝে পেয়েছি ........................................................</div>
          <div style={{ marginTop: '8px' }}>আয়ন কর্মকর্তার স্বাক্ষর</div>
          <div>নাম ....................................................................</div>
          <div>পদবি ...................................................................</div>
          <div style={{ marginTop: '14px' }}>সিল</div>
          <div style={{ marginTop: '8px' }}>
            স্থান{' '}
            {data.placeName ? (
              <span style={{ borderBottom: '1px dotted #000', padding: '0 8px' }}>
                {data.placeName}
              </span>
            ) : (
              '...................................................................'
            )}
          </div>
          <div>তারিখ ..................................................................</div>
        </div>
      </div>
    </SectionBox>
  );
}

/* ============================================================================
 * PAGE 2 — SECTION 3 (P2-S3): বরাদ্দ ও ব্যয়ের হিসাব টেবিল
 * ============================================================================ */
function SectionP2AccountingTables({ data, guided }: { data: Tr21FormData; guided: boolean }) {
  return (
    <SectionBox
      sectionId="P2-S3"
      guided={guided}
      className="tr21-avoid-break"
      style={{ marginTop: '24px' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '24px',
        }}
      >
        {/* Allocation Account (বরাদ্দের হিসাব) */}
        <table className="tr21-table" style={{ fontSize: '10.8px', lineHeight: 1.35 }}>
          <colgroup>
            <col style={{ width: '58%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 600 }}>
                বরাদ্দের হিসাব
              </th>
              <th style={{ padding: '4px 4px', textAlign: 'center', fontWeight: 600 }}>
                টাকা
              </th>
              <th style={{ padding: '4px 4px', textAlign: 'center', fontWeight: 600 }}>
                পয়সা
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '4px 6px' }}>১। শেষ বিলের টাকার অঙ্ক</td>
              <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {data.allocationSummary.lastBillAmount.takaStr}
              </td>
              <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                {data.allocationSummary.lastBillAmount.paisaStr}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '4px 6px' }}>
                ২। এ যাবত অতিরিক্ত বরাদ্দ (পত্র নং{' '}
                {data.allocationSummary.additionalRefNo || '....................'})
              </td>
              <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {data.allocationSummary.additionalAllocation.takaStr}
              </td>
              <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                {data.allocationSummary.additionalAllocation.paisaStr}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '4px 6px' }}>
                ৩। এ যাবত যে অঙ্কের বরাদ্দ কমানো হয়েছে। (পত্র নং{' '}
                {data.allocationSummary.reducedRefNo || '...................'})
              </td>
              <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {data.allocationSummary.reducedAllocation.takaStr}
              </td>
              <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                {data.allocationSummary.reducedAllocation.paisaStr}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '4px 6px', fontWeight: 600 }}>৪। নিট মোট</td>
              <td
                style={{
                  padding: '4px 6px',
                  textAlign: 'right',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {data.allocationSummary.netTotalAllocation.takaStr}
              </td>
              <td style={{ padding: '4px 4px', textAlign: 'center', fontWeight: 600 }}>
                {data.allocationSummary.netTotalAllocation.paisaStr}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Expense Account (ব্যয়ের হিসাব) */}
        <table className="tr21-table" style={{ fontSize: '10.8px', lineHeight: 1.35 }}>
          <colgroup>
            <col style={{ width: '58%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 600 }}>
                ব্যয়ের হিসাব
              </th>
              <th style={{ padding: '4px 4px', textAlign: 'center', fontWeight: 600 }}>
                টাকা
              </th>
              <th style={{ padding: '4px 4px', textAlign: 'center', fontWeight: 600 }}>
                পয়সা
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '4px 6px' }}>গত বিলের মোট জের (+)</td>
              <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {data.expenseSummary.previousTotal.takaStr}
              </td>
              <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                {data.expenseSummary.previousTotal.paisaStr}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '4px 6px' }}>এই বিলের মোট (+)</td>
              <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {data.expenseSummary.currentBillTotal.takaStr}
              </td>
              <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                {data.expenseSummary.currentBillTotal.paisaStr}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 6px' }}>সংযুক্ত-পূর্তকর্মের বিলের টাকা</td>
              <td style={{ padding: '6px 6px', textAlign: 'right' }}>
                {data.expenseSummary.attachedWorksAmount.takaStr}
              </td>
              <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                {data.expenseSummary.attachedWorksAmount.paisaStr}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '4px 6px', fontWeight: 600 }}>
                মোট (পরবর্তী বিলে জের টেনে নেওয়া হবে।
              </td>
              <td
                style={{
                  padding: '4px 6px',
                  textAlign: 'right',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {data.expenseSummary.cumulativeTotal.takaStr}
              </td>
              <td style={{ padding: '4px 4px', textAlign: 'center', fontWeight: 600 }}>
                {data.expenseSummary.cumulativeTotal.paisaStr}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionBox>
  );
}

/* ============================================================================
 * PAGE 2 — SECTION 4 (P2-S4): হিসাবরক্ষণ অফিস ও চেক প্রদানকারীর স্বাক্ষর
 * ============================================================================ */
function SectionP2AuditOffice({ guided }: { guided: boolean }) {
  return (
    <SectionBox
      sectionId="P2-S4"
      guided={guided}
      className="tr21-avoid-break"
      style={{
        marginTop: '22px',
        borderTop: '1px solid #000000',
        paddingTop: '8px',
        fontSize: '11px',
      }}
    >
      <div style={{ textAlign: 'center', fontWeight: 600, marginBottom: '4px' }}>
        হিসাবরক্ষণ অফিসের ব্যবহারের জন্য
      </div>
      <div>
        প্রদানের জন্য পাস করা হল, টাকা .......................................
        কথায়.......................................................................
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '24px',
          marginTop: '34px',
        }}
      >
        {/* Auditor */}
        <div>
          <div style={{ borderTop: '1px solid #000000', paddingTop: '3px' }}>
            অডিটর (স্বাক্ষর)
          </div>
          <div>নাম .......................................</div>
          <div>তাং.......................................</div>
          <div style={{ marginTop: '28px' }}>সিল</div>
        </div>

        {/* Super */}
        <div>
          <div style={{ borderTop: '1px solid #000000', paddingTop: '3px' }}>
            সুপার (স্বাক্ষর)
          </div>
          <div>নাম .......................................</div>
          <div>তাং.......................................</div>
          <div style={{ marginTop: '28px' }}>সিল</div>
          <div style={{ marginTop: '28px' }}>চেক নং ..............................</div>
        </div>

        {/* Accounts Officer */}
        <div>
          <div style={{ borderTop: '1px solid #000000', paddingTop: '3px' }}>
            নিরীক্ষা ও হিসাবরক্ষণ অফিসার (স্বাক্ষর)
          </div>
          <div>নাম .......................................</div>
          <div>তাং.......................................</div>
          <div style={{ marginTop: '28px' }}>সিল</div>
          <div style={{ marginTop: '28px' }}>তারিখ...................................</div>
        </div>
      </div>

      {/* Cheque Issuer Signature */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: '44px',
        }}
      >
        <div style={{ width: '215px' }}>
          <div
            style={{
              borderTop: '1px solid #000000',
              paddingTop: '3px',
              textAlign: 'center',
            }}
          >
            চেক প্রদানকারীর স্বাক্ষর
          </div>
          <div>নাম .......................................</div>
          <div>তাং .......................................</div>
          <div>সিল</div>
        </div>
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
    <div className={`tr21-document ${className}`} data-testid="tr21-bill-form">
      {/* ======================== PAGE 1 ======================== */}
      <section className="tr21-page tr21-page-1">
        {data.isDraft && <DraftWatermark />}

        <div style={{ position: 'relative', zIndex: 1 }}>
          <SectionP1Header data={data} guided={showSectionGuides} />
          <SectionP1CodeAndVoucher data={data} guided={showSectionGuides} />
          <SectionP1MainTable
            data={data}
            supplierLine={supplierLine}
            guided={showSectionGuides}
          />
          <SectionP1Clauses data={data} guided={showSectionGuides} />
        </div>
      </section>

      {/* ======================== PAGE 2 ======================== */}
      <section className="tr21-page tr21-page-2">
        {data.isDraft && <DraftWatermark />}

        <div style={{ position: 'relative', zIndex: 1, fontSize: '11.2px', lineHeight: 1.42 }}>
          <SectionP2Clauses data={data} guided={showSectionGuides} />
          <SectionP2Signatures data={data} guided={showSectionGuides} />
          <SectionP2AccountingTables data={data} guided={showSectionGuides} />
          <SectionP2AuditOffice guided={showSectionGuides} />
        </div>
      </section>
    </div>
  );
};
