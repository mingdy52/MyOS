import "dotenv/config";
import { getAllData } from "./notion/index.js";

const data = await getAllData();

for (const [name, records] of Object.entries(data)) {
  console.log(`\n[${name}] 총 ${records.length}건`);
  console.log(records.slice(0, 3));
}
