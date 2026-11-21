import { Search } from 'lucide-react';
import { EconomicCodeSelect } from './EconomicCodeSelect';

interface FilterBarProps {
  codeFilter: string;
  onCodeChange: (code: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  codePlaceholder?: string;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  className?: string;
}

export function FilterBar({
  codeFilter,
  onCodeChange,
  search,
  onSearchChange,
  codePlaceholder = 'সকল অর্থনৈতিক কোড',
  searchPlaceholder = 'খুঁজুন…',
  searchAriaLabel = 'Search',
  className = '',
}: FilterBarProps) {
  return (
    <div className={`flex flex-col sm:flex-row gap-2 w-full lg:w-auto ${className}`}>
      <div className="w-full sm:w-64">
        <EconomicCodeSelect
          value={codeFilter}
          onChange={(code) => onCodeChange(code)}
          placeholder={codePlaceholder}
          clearable
          includeInactive
          variant="compact"
        />
      </div>
      <div className="relative w-full sm:w-64">
        <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
          className="w-full min-h-[48px] sm:min-h-[44px] pl-9 pr-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>
    </div>
  );
}
