import { Client } from "@notionhq/client";

const notionApiKey = process.env.NOTION_API_KEY;
if (!notionApiKey) {
  throw new Error("NOTION_API_KEY is required");
}

export const notion = new Client({ auth: notionApiKey });

