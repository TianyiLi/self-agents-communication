import { createConsola } from "consola";

export const randomString = (len = 8) =>
  Array(len)
    .fill("")
    .map((c) => Math.random().toString(26).at(2))
    .join("");

export const logger = createConsola({
  level: 4,
});
