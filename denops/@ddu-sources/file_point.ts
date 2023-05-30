import {
  BaseSource,
  Context,
  Item,
} from "https://deno.land/x/ddu_vim@v2.8.4/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.8.4/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.0/file.ts";
import {
  extname,
  isAbsolute,
  join,
} from "https://deno.land/std@0.188.0/path/mod.ts";

type Params = Record<string, never>;

const FIND_PATTERN = ".**5";
const MAX_BACKWARD = 100;

export class Source extends BaseSource<Params> {
  override kind = "file";

  private line = "";
  private cfile = "";
  private lineNr = -1;
  private col = -1;

  override async onInit(args: {
    denops: Denops;
  }): Promise<void> {
    this.lineNr = await fn.line(args.denops, ".");
    this.col = await fn.col(args.denops, ".");
    this.line = await fn.getline(args.denops, ".") +
      await fn.getline(args.denops, this.lineNr + 1);
    this.cfile = await args.denops.call(
      "ddu#source#file_point#cfile",
      this.line,
      this.col,
    ) as string;
  }

  override gather(args: {
    denops: Denops;
    context: Context;
    sourceParams: Params;
  }): ReadableStream<Item<ActionData>[]> {
    const cfile = this.cfile;
    const line = this.line;
    const col = this.col;
    let checkLineNr = this.lineNr - 1;

    return new ReadableStream({
      async start(controller) {
        if (cfile.length == 0) {
          controller.close();
          return;
        }

        const cwd = await fn.getcwd(args.denops) as string;

        let matched: RegExpMatchArray | null = null;
        for (
          const re of [
            // NOTE: "{path}", line {line}
            /["']([/a-zA-Z_][^"]*)["'],? line:? (\d+)/,
            // NOTE: {path}({line},{col})
            /([/a-zA-Z_]\S+)\((\d+),(\d+)\)/,
            // NOTE: {path}:{line}:{col}
            /([/a-zA-Z_][^: ]+)(?:[: ])(\d+)(?::(\d+))?/,
            // NOTE: {line}:{col}: messages
            /()\s+(\d+):(\d+).*$/,
          ]
        ) {
          matched = line.match(re);

          if (matched) {
            break;
          }
        }

        const toAbs = (path: string, cwd: string): string => {
          return isAbsolute(path) ? path : join(cwd, path);
        };

        if (matched) {
          const parseMatched = (
            ary: string[],
            index: number,
            def: number | string,
          ) => {
            return ary[index] ?? def;
          };

          const matchedPath = parseMatched(matched, 1, "");

          let find = await fn.findfile(
            args.denops,
            matchedPath,
            FIND_PATTERN,
          ) as string;

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
            if (line.length == 0) {
              break;
            }

            const cfile = await args.denops.call(
              "ddu#source#file_point#cfile",
              line[0],
              col,
            ) as string;

            find = await fn.findfile(
              args.denops,
              cfile,
              FIND_PATTERN,
            ) as string;

            checkLineNr -= 1;
            count++;
          }

          if (find.length != 0) {
            controller.enqueue([
              {
                word: matched[0],
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
          controller.enqueue(
            [{ word: cfile, action: { path: cfile } }],
          );
        } else if (cfile.includes("/") || extname(cfile).length != 0) {
          const finds = await fn.findfile(
            args.denops,
            cfile,
            FIND_PATTERN,
            -1,
          ) as string[];
          if (finds.length != 0) {
            controller.enqueue(
              finds.map((find) => {
                return {
                  word: find,
                  action: { path: toAbs(find, cwd) },
                };
              }),
            );
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
