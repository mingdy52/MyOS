import "dotenv/config";
import { getExpenses } from "./notion/expense.js";

const expenses = await getExpenses();
console.log(`총 ${expenses.length}건 조회됨`);
console.log(expenses.slice(0, 3));
