export type TransactionType = "income" | "expense" | "transfer";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

export interface Account {
  id: string;
  name: string;
  type: "cash" | "card" | "savings" | "other";
  openingBalance: number;
  color: string;
  icon?: string;
  archived?: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  type: "income" | "expense";
  color: string;
  icon?: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  accountId: string;
  /** For transfers: destination account */
  toAccountId?: string;
  /** Optional for transfers */
  categoryId?: string;
  note?: string;
  date: string; // ISO date (yyyy-mm-dd)
  createdAt: string;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  deadline?: string; // ISO date
  accountId?: string;
  color: string;
  icon?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Debt {
  id: string;
  name: string;
  /** Total amount owed (initial principal). */
  totalAmount: number;
  /** Amount already paid. */
  paidAmount: number;
  /** Optional lender/creditor name. */
  creditor?: string;
  /** Optional due date (ISO). */
  dueDate?: string;
  color: string;
  icon?: string;
  note?: string;
  createdAt: string;
  closedAt?: string;
}

export interface Reminder {
  id: string;
  title: string;
  amount: number;
  type: "income" | "expense";
  accountId: string;
  categoryId?: string;
  frequency: RecurrenceFrequency;
  nextDate: string; // ISO date
  note?: string;
  active: boolean;
  createdAt: string;
  lastAppliedAt?: string;
}

export interface AppData {
  version: number;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  goals: Goal[];
  debts: Debt[];
  reminders: Reminder[];
  settings: {
    currency: string;
    locale: string;
    monthStartDay: number;
  };
}
