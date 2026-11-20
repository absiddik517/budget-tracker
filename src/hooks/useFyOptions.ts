import { useMemo } from 'react';
import { useApp } from '../contexts/AppContext';

export function useFyOptions(): string[] {
  const { selectedFy, officeSettings } = useApp();

  return useMemo(() => {
    return Array.from(
      new Set([
        selectedFy,
        officeSettings.activeFiscalYear,
        ...officeSettings.fiscalYears,
      ])
    )
      .filter(Boolean)
      .sort()
      .reverse();
  }, [selectedFy, officeSettings.activeFiscalYear, officeSettings.fiscalYears]);
}
