export const formatWallet = (
  address?: string | null,
  visibleChars = 5
): string => {
  if (!address || typeof address !== "string") return "—";

  if (address.length <= visibleChars * 2) return address;

  const start = address.slice(0, visibleChars);
  const end = address.slice(-visibleChars);
  return `${start}...${end}`;
};
