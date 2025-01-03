import { type Context, type Item } from "jsr:@shougo/ddu-vim@~9.1.0/types";
import { BaseSource } from "jsr:@shougo/ddu-vim@~9.1.0/source";

import { type ActionData as ActionFile } from "jsr:@shougo/ddu-kind-file@~0.9.0";
import { type ActionData as ActionUrl } from "jsr:@4513echo/ddu-kind-url@~0.7.0";

import type { Denops } from "jsr:@denops/core@~7.0.0";
import * as fn from "jsr:@denops/std@~7.4.0/function";
import * as op from "jsr:@denops/std@~7.4.0/option";

import { extname } from "jsr:@std/path@~1.0.3/extname";
import { isAbsolute } from "jsr:@std/path@~1.0.3/is-absolute";
import { join } from "jsr:@std/path@~1.0.3/join";

type Params = Record<string, never>;

const FIND_PATTERN = ".**5";
const MAX_BACKWARD = 100;

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
      // NOTE: auto wrap for termianl buffer
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
    let checkLineNr = this.#lineNr - 1;

    return new ReadableStream({
      async start(controller) {
        const cwd = await fn.getcwd(args.denops) as string;

        let matched: RegExpMatchArray | null = null;
        for (
          const re of [
            // NOTE: "{path}", line {line}
            /["']([./a-zA-Z_][^"]*)["'],? line:? (\d+)/,
            // NOTE: {path}({line},{col})
            /([./a-zA-Z_]\S+)\((\d+),(\d+)\)/,
            // NOTE: {path}:{line}:{col}
            /([./a-zA-Z_][^: ]+)(?:[: ])(\d+)(?::(\d+))?/,
            // NOTE: {line}:{col}: messages
            /()\s+(\d+):(\d+).*$/,
            // NOTE: @@ -{line},{col}, +{line},{col} @@
            /^()@@ [-+](\d+),(\d+) [-+](\d+),(\d+) @@(.*$)/,
          ]
        ) {
          matched = line.match(re);

          if (matched) {
            break;
          }
        }

        if (matched) {
          const parseMatched = (
            ary: string[],
            index: number,
            def: number | string,
          ) => {
            return ary[index] ?? def;
          };

          const matchedPath = parseMatched(matched, 1, "");

          let find = await findfile(
            args.denops,
            cwd,
            matchedPath,
          );

          let count = 0;
          while (
            matchedPath.length === 0 && find.length === 0 &&
            count < MAX_BACKWARD
          ) {
            // Search to backward.
            const line = await fn.getbufline(
              args.denops,
              args.context.bufNr,
              checkLineNr,
            ) as string[];
            if (line.length === 0) {
              break;
            }
            if (autoWrap) {
              // NOTE: auto wrap for termianl buffer
              const nextLine = await fn.getbufline(
                args.denops,
                args.context.bufNr,
                checkLineNr + 1,
              );
              if (nextLine.length !== 0) {
                line[0] += nextLine;
              }
            }

            let cfile = await args.denops.call(
              "ddu#source#file_point#cfile",
              line[0],
              col,
            ) as string;

            if (cfile.startsWith("a/") || cfile.startsWith("b/")) {
              // Remove prefiex.
              cfile = cfile.slice(2);
            }

            find = await findfile(args.denops, cwd, cfile);

            checkLineNr -= 1;
            count++;
          }

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
          (cfile.includes("/") || extname(cfile).length != 0) &&
          !(new RegExp("^/+$").test(cfile))
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
    );
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
