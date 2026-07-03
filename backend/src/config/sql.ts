export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

export type SqlFragment = {
  text: string;
  values: unknown[];
};

export const emptySql: SqlFragment = { text: '', values: [] };

function isSqlFragment(val: unknown): val is SqlFragment {
  return (
    typeof val === 'object' &&
    val !== null &&
    'text' in val &&
    'values' in val &&
    typeof (val as SqlFragment).text === 'string' &&
    Array.isArray((val as SqlFragment).values)
  );
}

export const sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
): SqlFragment => {
  let text = '';
  const finalValues: unknown[] = [];

  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      const val = values[i];
      if (isSqlFragment(val)) {
        // inline nested SqlFragment safely while shifting parameter numbers
        const shiftedText = val.text.replace(/\$(\d+)/g, (match, p1) => {
          const originalIdx = parseInt(p1, 10);
          const newIdx = finalValues.length + originalIdx;
          return `$${newIdx}`;
        });
        text += shiftedText;
        finalValues.push(...val.values);
      } else {
        finalValues.push(val);
        text += `$${finalValues.length}`;
      }
    }
  }

  return { text, values: finalValues };
};

export const joinSql = (
  fragments: SqlFragment[],
  separator = ', '
): SqlFragment => {
  if (fragments.length === 0) return emptySql;

  let text = '';
  const finalValues: unknown[] = [];

  for (let i = 0; i < fragments.length; i++) {
    if (i > 0) {
      text += separator;
    }
    const frag = fragments[i];
    const shiftedText = frag.text.replace(/\$(\d+)/g, (match, p1) => {
      const originalIdx = parseInt(p1, 10);
      const newIdx = finalValues.length + originalIdx;
      return `$${newIdx}`;
    });
    text += shiftedText;
    finalValues.push(...frag.values);
  }

  return { text, values: finalValues };
};

/**
 * Escape hatch for static raw SQL.
 * WARNING: NEVER use this with any user input or dynamic values.
 */
export const unsafeRawSqlForStaticTextOnly = (staticText: string): SqlFragment => {
  return {
    text: staticText,
    values: []
  };
};
