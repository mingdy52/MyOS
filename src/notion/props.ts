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

export function getMultiSelect(props: any, name: string) {
    return props[name]?.multi_select?.map((s: any) => s.name).join(", ") ?? "";
}