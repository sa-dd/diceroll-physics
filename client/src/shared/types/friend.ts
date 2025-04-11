export interface IFriend {
  id: number;
  photoUrl: string;
  name: string;
  earned: number;
}

export interface IGetFriend {
  friends: IFriend[];
  friendNumber: number;
  referralLink: string;
}
