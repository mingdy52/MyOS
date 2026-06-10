import { notion } from "./client.js";
import { schemas, type FieldType } from "./schema.js";
import { readProperty } from "./props.js";

// 값 하나(JS)를 노션 속성 payload로 바꾼다.
// 읽을 때 쓰던 props.ts의 get* 들과 정확히 반대 방향이다.
function toProperty(type: FieldType, value: any) {
  switch (type) {
    case "title":
      return { title: [{ text: { content: String(value) } }] };
    case "text":
      return { rich_text: [{ text: { content: String(value) } }] };
    case "number":
      return { number: Number(value) };
    case "select":
      return { select: { name: String(value) } };
    case "multi_select": {
      // "식비, 외식" 같은 문자열도, ["식비","외식"] 배열도 받아준다.
      const names = Array.isArray(value)
        ? value
        : String(value)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      return { multi_select: names.map((name: string) => ({ name })) };
    }
    case "status":
      return { status: { name: String(value) } };
    case "date": {
      // "2026-06-03" 또는 "2026-06-01 ~ 2026-06-03"(기간) 둘 다 처리.
      const [start, end] = String(value)
        .split("~")
        .map((s) => s.trim());
      return { date: end ? { start, end } : { start } };
    }
    case "checkbox":
      return { checkbox: Boolean(value) };
  }
}

// fields(컬럼명 → 값)를 노션 properties payload로 바꾼다.
// 스키마에 없는 컬럼은 오타일 수 있으니 막아서 알려준다.
function buildProperties(database: string, fields: Record<string, any>) {
  const schema = schemas[database];
  if (!schema) throw new Error(`알 수 없는 데이터베이스: ${database}`);

  const properties: Record<string, any> = {};
  for (const [column, value] of Object.entries(fields ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    const type = schema.columns[column];
    if (!type) {
      const 가능 = Object.keys(schema.columns).join(", ");
      throw new Error(`'${database}'에 없는 컬럼: ${column} (가능한 컬럼: ${가능})`);
    }
    properties[column] = toProperty(type, value);
  }
  return properties;
}

// 새 행을 추가한다.
export async function createRecord(
  database: string,
  fields: Record<string, any>
) {
  const schema = schemas[database];
  if (!schema) throw new Error(`알 수 없는 데이터베이스: ${database}`);

  const page = await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: schema.dataSourceId },
    properties: buildProperties(database, fields),
  });
  return { ok: true, id: page.id };
}

// 수정 전 미리보기용: 바뀔 컬럼들의 "지금 값"만 읽어온다.
// 확인 프롬프트에서 "기존값 → 새값"으로 보여주는 데 쓴다.
export async function getCurrentValues(
  database: string,
  id: string,
  columns: string[]
): Promise<Record<string, any>> {
  const schema = schemas[database];
  if (!schema) throw new Error(`알 수 없는 데이터베이스: ${database}`);

  const page: any = await notion.pages.retrieve({ page_id: id });
  const current: Record<string, any> = {};
  for (const column of columns) {
    const type = schema.columns[column];
    if (type) current[column] = readProperty(page.properties, column, type);
  }
  return current;
}

// 기존 행을 수정한다. id는 읽기(get_*) 결과에 들어 있는 id를 그대로 쓴다.
// fields에는 "바꿀 컬럼"만 넣으면 된다(나머지는 그대로 유지됨).
export async function updateRecord(
  database: string,
  id: string,
  fields: Record<string, any>
) {
  if (!id) throw new Error("수정하려면 id가 필요하다. 먼저 읽어서 id를 확인해라.");

  await notion.pages.update({
    page_id: id,
    properties: buildProperties(database, fields),
  });
  return { ok: true, id };
}
