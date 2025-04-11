export const formatBalance = (amount?: number): string => {
  if (!amount) return "0";
  if (amount >= 1_000_000_000) return (amount / 1_000_000_000).toFixed(1) + "b";
  if (amount >= 1_000_000) return (amount / 1_000_000).toFixed(1) + "m";
  if (amount >= 1_000) return (amount / 1_000).toFixed(1) + "k";
  return amount.toString();
};
