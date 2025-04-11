export const PUBLIC_URL = {
  root: (url = "") => `${url ? url : ""}`,

  home: () => PUBLIC_URL.root("/home"),
  dice: () => PUBLIC_URL.root("/dice"),
  referrals: () => PUBLIC_URL.root("/referrals"),
  earn: () => PUBLIC_URL.root("/earn"),
  leader: () => PUBLIC_URL.root("/leader"),
  onboard: () => PUBLIC_URL.root("/onboard"),
  guide: () => PUBLIC_URL.root("/game/guide"),
};
