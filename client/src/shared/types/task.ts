export type TaskSection = "Rollies" | "Partners";
export type TaskStatus = "InProgress" | "Completed";
export type RewardType = "Diamonds" | "Rolls";

export interface ITask {
  id: number;
  title: string;
  reward: number;
  imageUrl: string;
  link: string;
  channelId: string;
  section: TaskSection;
  rewardType: RewardType;
}

export interface IUserTask extends ITask {
  status: TaskStatus;
  availableAt: Date;
}
