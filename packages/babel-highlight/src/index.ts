/// <reference path="../../../lib/third-party-libs.d.ts" />

import jsTokens, * as jsTokensNs from "js-tokens";
import type { Token, JSXToken } from "js-tokens";
import {
  isStrictReservedWord,
  isKeyword,
} from "@babel/helper-validator-identifier";
import Chalk from "chalk";

type ChalkClass = ReturnType<typeof getChalk>;

/**
 * Names that are always allowed as identifiers, but also appear as keywords
 * within certain syntactic productions.
 *
 * https://tc39.es/ecma262/#sec-keywords-and-reserved-words
 *
 * `target` has been omitted since it is very likely going to be a false
 * positive.
 */
const sometimesKeywords = new Set(["as", "async", "from", "get", "of", "set"]);

type InternalTokenType =
  | "keyword"
  | "capitalized"
  | "jsxIdentifier"
  | "punctuator"
  | "number"
  | "string"
  | "regex"
  | "comment"
  | "invalid";

/**
 * Chalk styles for token types.
 */
function getDefs(chalk: ChalkClass): Record<InternalTokenType, ChalkClass> {
  return {
    keyword: chalk.cyan,
    capitalized: chalk.yellow,
    jsxIdentifier: chalk.yellow,
    punctuator: chalk.yellow,
    number: chalk.magenta,
    string: chalk.green,
    regex: chalk.magenta,
    comment: chalk.grey,
    invalid: chalk.white.bgRed.bold,
  };
}

/**
 * RegExp to test for newlines in terminal.
 */
const NEWLINE = /\r\n|[\n\r\u2028\u2029]/;

/**
 * RegExp to test for the three types of brackets.
 */
const BRACKET = /^[()[\]{}]$/;

let tokenize: (
  text: string,
) => Generator<{ type: InternalTokenType | "uncolored"; value: string }>;

if (process.env.BABEL_8_BREAKING) {
  /**
   * Get the type of token, specifying punctuator type.
   */
  const getTokenType = function (
    token: Token | JSXToken,
  ): InternalTokenType | "uncolored" {
    if (token.type === "IdentifierName") {
      if (
        isKeyword(token.value) ||
        isStrictReservedWord(token.value, true) ||
        sometimesKeywords.has(token.value)
      ) {
        return "keyword";
      }

      if (token.value[0] !== token.value[0].toLowerCase()) {
        return "capitalized";
      }
    }

    if (token.type === "Punctuator" && BRACKET.test(token.value)) {
      return "uncolored";
    }

    if (
      token.type === "Invalid" &&
      (token.value === "@" || token.value === "#")
    ) {
      return "punctuator";
    }

    switch (token.type) {
      case "NumericLiteral":
        return "number";

      case "StringLiteral":
      case "JSXString":
      case "NoSubstitutionTemplate":
        return "string";

      case "RegularExpressionLiteral":
        return "regex";

      case "Punctuator":
      case "JSXPunctuator":
        return "punctuator";

      case "MultiLineComment":
      case "SingleLineComment":
        return "comment";

      case "Invalid":
      case "JSXInvalid":
        return "invalid";

      case "JSXIdentifier":
        return "jsxIdentifier";

      default:
        return "uncolored";
    }
  };

  /**
   * Turn a string of JS into an array of objects.
   */
  tokenize = function* (text: string) {
    for (const token of jsTokens(text, { jsx: true })) {
      switch (token.type) {
        case "TemplateHead":
          yield { type: "string", value: token.value.slice(0, -2) };
          yield { type: "punctuator", value: "${" };
          break;

        case "TemplateMiddle":
          yield { type: "punctuator", value: "}" };
          yield { type: "string", value: token.value.slice(1, -2) };
          yield { type: "punctuator", value: "${" };
          break;

        case "TemplateTail":
          yield { type: "punctuator", value: "}" };
          yield { type: "string", value: token.value.slice(1) };
          break;

        default:
          yield {
            type: getTokenType(token),
            value: token.value,
          };
      }
    }
  };
} else {
  // This is only available in js-tokens@4, and not in js-tokens@6
  const { matchToToken } = jsTokensNs as any;

  /**
   * RegExp to test for what seems to be a JSX tag name.
   */
  const JSX_TAG = /^[a-z][\w-]*$/i;

  const getTokenType = function (token, offset, text) {
    if (token.type === "name") {
      if (
        isKeyword(token.value) ||
        isStrictReservedWord(token.value, true) ||
        sometimesKeywords.has(token.value)
      ) {
        return "keyword";
      }

      if (
        JSX_TAG.test(token.value) &&
        (text[offset - 1] === "<" || text.substr(offset - 2, 2) == "</")
      ) {
        return "jsxIdentifier";
      }

      if (token.value[0] !== token.value[0].toLowerCase()) {
        return "capitalized";
      }
    }

    if (token.type === "punctuator" && BRACKET.test(token.value)) {
      return "bracket";
    }

    if (
      token.type === "invalid" &&
      (token.value === "@" || token.value === "#")
    ) {
      return "punctuator";
    }

    return token.type;
  };

  tokenize = function* (text: string) {
    let match;
    while ((match = (jsTokens as any).exec(text))) {
      const token = matchToToken(match);

      yield {
        type: getTokenType(token, match.index, text),
        value: token.value,
      };
    }
  };
}

/**
 * Highlight `text` using the token definitions in `defs`.
 */
function highlightTokens(defs: Record<string, ChalkClass>, text: string) {
  let highlighted = "";

  for (const { type, value } of tokenize(text)) {
    const colorize = defs[type];
    if (colorize) {
      highlighted += value
        .split(NEWLINE)
        .map(str => colorize(str))
        .join("\n");
    } else {
      highlighted += value;
    }
  }

  return highlighted;
}

/**
 * Highlight `text` using the token definitions in `defs`.
 */

type Options = {
  forceColor?: boolean;
};

/**
 * Whether the code should be highlighted given the passed options.
 */
export function shouldHighlight(options: Options): boolean {
  return !!Chalk.supportsColor || options.forceColor;
}

/**
 * The Chalk instance that should be used given the passed options.
 */
export function getChalk(options: Options) {
  return options.forceColor
    ? new Chalk.constructor({ enabled: true, level: 1 })
    : Chalk;
}

/**
 * Highlight `code`.
 */
export default function highlight(code: string, options: Options = {}): string {
  if (shouldHighlight(options)) {
    const chalk = getChalk(options);
    const defs = getDefs(chalk);
    return highlightTokens(defs, code);
  } else {
    return code;
  }
}
