import type { FieldType } from "./schema.js";

// 타입에 맞는 getter를 골라 값 하나를 읽는다.
// mutate.ts의 toProperty(쓰기)와 정확히 반대 짝이다.
export function readProperty(props: any, name: string, type: FieldType) {
  switch (type) {
    case "title":
      return getTitle(props, name);
    case "text":
      return getRichText(props, name);
    case "number":
      return getNumber(props, name);
    case "select":
      return getSelect(props, name);
    case "multi_select":
      return getMultiSelect(props, name);
    case "status":
      return getStatus(props, name);
    case "date":
      return getDate(props, name);
    case "checkbox":
      return getCheckbox(props, name);
  }
}

export function getTitle(props: any, name: string) {
    return props[name]?.title?.[0]?.plain_text ?? "";
}

export function getDate(props: any, name: string) {
    const date = props[name]?.date;
    if (!date) return "";
    if (date.end) return `${date.start} ~ ${date.end}`;
    return date.start;
}

export function getNumber(props: any, name: string) {
    return props[name]?.number ?? 0;
}   

export function getCheckbox(props: any, name: string) {
    return props[name]?.checkbox ?? false;
}

export function getRichText(props: any, name: string) {
    return props[name]?.rich_text?.[0]?.plain_text ?? "";   
} 

export function getSelect(props: any, name: string) {
    return props[name]?.select?.name ?? "";
}

export function getMultiSelect(props: any, name: string) {
    return props[name]?.multi_select?.map((s: any) => s.name).join(", ") ?? "";
}

export function getStatus(props: any, name: string) {
    return props[name]?.status?.name ?? "";
}