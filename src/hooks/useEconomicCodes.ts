import { useApp } from '../contexts/AppContext';

export function useEconomicCodes() {
  const { economicCodes, economicCodesLoading, getCodeEntry, getHead } = useApp();
  return {
    economicCodes,
    loading: economicCodesLoading,
    getCodeEntry,
    getHead,
  };
}
