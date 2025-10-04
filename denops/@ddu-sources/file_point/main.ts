import type { Context, Item } from "@shougo/ddu-vim/types";
import { BaseSource } from "@shougo/ddu-vim/source";

import type { ActionData as ActionFile } from "@shougo/ddu-kind-file";
import type { ActionData as ActionUrl } from "@4513echo/ddu-kind-url";

import type { Denops } from "@denops/std";
import * as fn from "@denops/std/function";
import * as op from "@denops/std/option";

import { extname } from "@std/path/extname";
import { isAbsolute } from "@std/path/is-absolute";
import { join } from "@std/path/join";
import { assertMatch, assertNotMatch } from "@std/assert";

type Params = Record<string, never>;

const FIND_PATTERN = ".**5";

export const RE_PATTERNS = [
  // NOTE: {path}:{line}:{col} (パスは単独でキャプチャ)
  /^(?!https?:\/\/)([A-Za-z]:[\\/][\w./\\~-]+|[~./\\a-zA-Z_][\w./\\~-]+):(\d+)(?::(\d+))?/,
  // NOTE: "{path}", line {line}
  /["']([A-Za-z]:[\\/][^"]*|[~./\\a-zA-Z_][^"]*)["'],?\s+line:?\s+(\d+)/,
  // NOTE: {path}({line},{col})
  /([A-Za-z]:[\\/][\w./\\@~-]+|[~./\\a-zA-Z_][\w./\\@~-]+)\s*\((\d+),\s*(\d+)(?:-(\d+))?\)/,
  // NOTE: {path} line {line}:
  /([A-Za-z]:[\\/][\S]*|[~./\\a-zA-Z_]\S*[/.\\]\S*)\s+line\s+(\d+):/,
  // NOTE: {path} {line}:{col}
  /([A-Za-z]:[\\/][\S]*|[~./\\a-zA-Z_]\S*)\s+(\d+):(\d+)/,
  // NOTE: {line}:{col}: messages
  /^()\s+(\d+):(\d+).*$/,
  // NOTE: @@ -{line},{col}, +{line},{col} @@
  /^()@@\s+[-+](\d+),(\d+)\s+[-+](\d+),(\d+)\s+@@(.*$)/,
];

export class Source extends BaseSource<Params> {
  #line = "";
  #cfile = "";
  #lineNr = -1;
  #col = -1;
  #autoWrap = false;

  override async onInit(args: {
    denops: Denops;
  }): Promise<void> {
    this.#lineNr = await fn.line(args.denops, ".");
    this.#col = await fn.col(args.denops, ".");
    this.#line = await fn.getline(args.denops, ".");

    // NOTE: auto wrap for termianl buffer
    this.#autoWrap = await op.buftype.getLocal(args.denops) === "terminal";

    const maxCol = await fn.col(args.denops, "$");
    const winWidth = await fn.winwidth(args.denops, 0) as number;

    if (maxCol > winWidth && this.#autoWrap) {
      // NOTE: auto wrap for terminal buffer
      this.#line += await fn.getline(args.denops, this.#lineNr + 1);
    }

    this.#cfile = await args.denops.call(
      "ddu#source#file_point#cfile",
      this.#line,
      this.#col,
    ) as string;
  }

  override gather(args: {
    denops: Denops;
    context: Context;
    sourceParams: Params;
  }): ReadableStream<Item<ActionFile | ActionUrl>[]> {
    const cfile = this.#cfile;
    const line = this.#line;
    const col = this.#col;
    const autoWrap = this.#autoWrap;
    const currentLineNr = this.#lineNr;
    let found = false;

    return new ReadableStream({
      async start(controller) {
        const cwd = await fn.getcwd(args.denops) as string;

        const parseMatched = (
          ary: string[],
          index: number,
          def: number | string,
        ) => {
          return ary[index] ?? def;
        };

        const checkLines = [];

        if (autoWrap) {
          // Search to prev line.
          const prevLine = await fn.getbufline(
            args.denops,
            args.context.bufNr,
            currentLineNr - 1,
          );
          if (prevLine.length !== 0) {
            checkLines.push({
              line: prevLine[0] + line,
              col: col + prevLine[0].length,
            });
          }
        }

        checkLines.push({
          line: line,
          col: col,
        });

        for (const re of RE_PATTERNS) {
          for (const checkLine of checkLines) {
            const matched = checkLine.line.match(re);

            if (matched) {
              let cfile = await args.denops.call(
                "ddu#source#file_point#cfile",
                checkLine.line,
                checkLine.col,
              ) as string;

              if (cfile.startsWith("a/") || cfile.startsWith("b/")) {
                // Remove prefiex.
                cfile = cfile.slice(2);
              }

              const find = await findfile(args.denops, cwd, cfile);

              if (find.length != 0) {
                controller.enqueue([
                  {
                    word: matched[0],
                    kind: "file",
                    action: {
                      path: toAbs(find, cwd),
                      lineNr: Number(parseMatched(matched, 2, 0)),
                      col: Number(parseMatched(matched, 3, 0)),
                    },
                  },
                ]);

                found = true;
                break;
              }
            }
          }

          if (found) {
            break;
          }
        }

        if (new RegExp("^https?://").test(cfile)) {
          controller.enqueue([{
            word: cfile,
            kind: "url",
            action: {
              url: cfile,
            },
          }]);
        } else if (
          !found && !(new RegExp("^/+$").test(cfile)) &&
          (cfile.includes("/") || extname(cfile).length != 0)
        ) {
          const find = await findfile(args.denops, cwd, cfile);
          if (find.length != 0) {
            controller.enqueue([
              {
                word: find,
                kind: "file",
                action: { path: toAbs(find, cwd) },
              },
            ]);
          }
        }

        controller.close();
      },
    });
  }

  override params(): Params {
    return {};
  }
}

const toAbs = (path: string, cwd: string): string => {
  return isAbsolute(path) ? path : join(cwd, path);
};

const findfile = async (denops: Denops, cwd: string, path: string) => {
  if (await exists(path) || await exists(toAbs(path, cwd))) {
    return path;
  } else {
    return await fn.findfile(
      denops,
      // NOTE: Remove "./" from path.  Because findfile() does not work well.
      path.replace(/^.\//, ""),
      FIND_PATTERN,
    ) as string;
  }
};

const exists = async (path: string) => {
  // Note: Deno.stat() may be failed
  try {
    const stat = await Deno.stat(path);
    if (stat.isDirectory || stat.isFile || stat.isSymlink) {
      return true;
    }
  } catch (_: unknown) {
    // Ignore stat exception
  }

  return false;
};

Deno.test("RE_PATTERNS[0] matches {path}:{line}:{col}", () => {
  assertMatch("foo/bar.txt:123:45", RE_PATTERNS[0]);
  assertMatch("./foo.txt:1", RE_PATTERNS[0]);
  assertNotMatch("http://foo.txt:123:45", RE_PATTERNS[0]);
});

Deno.test("RE_PATTERNS[0] matches Windows path {path}:{line}:{col}", () => {
  assertMatch("C:\\WINDOWS\\System32\\drivers\\etc\\hosts:4", RE_PATTERNS[0]);
});

Deno.test("RE_PATTERNS[0] matches home path {path}:{line}:{col}", () => {
  assertMatch("~/.gitconfig:4", RE_PATTERNS[0]);
});

Deno.test('RE_PATTERNS[1] matches "{path}", line {line}', () => {
  assertMatch('"foo/bar.txt", line 123', RE_PATTERNS[1]);
  assertMatch("'foo.txt', line: 1", RE_PATTERNS[1]);
  assertNotMatch("foo.txt line 1", RE_PATTERNS[1]);
});

Deno.test("RE_PATTERNS[2] matches {path}({line},{col})", () => {
  assertMatch("foo/bar.txt(123,45)", RE_PATTERNS[2]);
  assertMatch("./foo.txt(1, 2-5)", RE_PATTERNS[2]);
  assertNotMatch("foo.txt:1:2", RE_PATTERNS[2]);
});

Deno.test("RE_PATTERNS[3] matches {path} line {line}:", () => {
  assertMatch("foo/bar.txt line 123:", RE_PATTERNS[3]);
  assertMatch("./foo.js line 1:", RE_PATTERNS[3]);
  assertNotMatch("foo.txt line 1", RE_PATTERNS[3]);
});

Deno.test("RE_PATTERNS[4] matches {path} {line}:{col}", () => {
  assertMatch("foo/bar.txt 123:45", RE_PATTERNS[4]);
  assertMatch("./foo.js 1:2", RE_PATTERNS[4]);
  assertNotMatch("foo.txt:1:2", RE_PATTERNS[4]);
});

Deno.test("RE_PATTERNS[5] matches {line}:{col}: messages", () => {
  assertMatch("  123:45: error message", RE_PATTERNS[5]);
  assertMatch("  1:2: info", RE_PATTERNS[5]);
  assertNotMatch("foo.txt 1:2", RE_PATTERNS[5]);
});

Deno.test("RE_PATTERNS[6] matches diff @@ -{line},{col} +{line},{col} @@", () => {
  assertMatch("@@ -123,45 +67,89 @@ function foo", RE_PATTERNS[6]);
  assertMatch("@@ -1,2 +3,4 @@", RE_PATTERNS[6]);
  assertNotMatch("foo.txt:1:2", RE_PATTERNS[6]);
});

const testCases = [
  {
    pattern: RE_PATTERNS[0],
    input: "C:\\WINDOWS\\System32\\drivers\\etc\\hosts:4",
    expect: {
      path: "C:\\WINDOWS\\System32\\drivers\\etc\\hosts",
      line: "4",
      col: undefined,
    },
  },
  {
    pattern: RE_PATTERNS[0],
    input: "~/.gitconfig:4",
    expect: {
      path: "~/.gitconfig",
      line: "4",
      col: undefined,
    },
  },
  {
    pattern: RE_PATTERNS[0],
    input: "~/foo/bar.txt:123:45",
    expect: {
      path: "~/foo/bar.txt",
      line: "123",
      col: "45",
    },
  },
  {
    pattern: RE_PATTERNS[1],
    input: '"foo/bar.txt", line 10',
    expect: {
      path: "foo/bar.txt",
      line: "10",
    },
  },
  {
    pattern: RE_PATTERNS[2],
    input: "~/.vimrc(15,8)",
    expect: {
      path: "~/.vimrc",
      line: "15",
      col: "8",
    },
  },
  {
    pattern: RE_PATTERNS[3],
    input: "~/foo.txt line 9:",
    expect: {
      path: "~/foo.txt",
      line: "9",
    },
  },
  {
    pattern: RE_PATTERNS[4],
    input: "~/foo.txt 7:3",
    expect: {
      path: "~/foo.txt",
      line: "7",
      col: "3",
    },
  },
];

for (const [i, { pattern, input, expect }] of testCases.entries()) {
  Deno.test(`RE_PATTERNS match and capture group test #${i + 1}: ${input}`, () => {
    const m = input.match(pattern);
    assertMatch(input, pattern);
    if (m) {
      if (expect.path !== undefined) {
        if (m[1] !== expect.path) {
          throw new Error(`Expected path='${expect.path}', got '${m[1]}'`);
        }
      }
      if (expect.line !== undefined) {
        if (m[2] !== expect.line) {
          throw new Error(`Expected line='${expect.line}', got '${m[2]}'`);
        }
      }
      if ("col" in expect && expect.col !== undefined) {
        if (m[3] !== expect.col) {
          throw new Error(`Expected col='${expect.col}', got '${m[3]}'`);
        }
      }
    } else {
      throw new Error(`Pattern did not match: ${input}`);
    }
  });
}
