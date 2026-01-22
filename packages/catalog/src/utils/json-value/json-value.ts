// https://github.com/vercel/ai/blob/4c44a5bea002ef0db0e1b86a1e223cd9f4837d62/packages/provider/src/json-value/json-value.ts

/**
A JSON value can be a string, number, boolean, object, array, or null.
JSON values can be serialized and deserialized by the JSON.stringify and JSON.parse methods.
 */
export type JSONValue = null | string | number | boolean | JSONObject | JSONArray

export type JSONObject = {
  [key: string]: JSONValue | undefined
}

export type JSONArray = JSONValue[]
