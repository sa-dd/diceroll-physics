export interface ILeader {
  id: number;
  name: string;
  photoUrl: string;
  balance: number;
}

export interface IGetRating {
  leaders: ILeader[];
  totalUsers: number;
}
