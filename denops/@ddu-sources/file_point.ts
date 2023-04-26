import { BaseSource, Item } from "https://deno.land/x/ddu_vim@v2.8.3/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.8.3/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.0/file.ts";
import {
  extname,
  isAbsolute,
  join,
} from "https://deno.land/std@0.184.0/path/mod.ts";

type Params = Record<string, never>;

const FIND_PATTERN = ".**5";

export class Source extends BaseSource<Params> {
  override kind = "file";

  private line = "";
  private cfile = "";

  override async onInit(args: {
    denops: Denops;
  }): Promise<void> {
    this.line = await fn.getline(args.denops, ".");

    try {
      // Remove "file://" prefix pattern
      this.cfile = (await fn.expand(args.denops, "<cfile>") as string).replace(
        /^file:\/\//,
        "",
      );
    } catch (_: unknown) {
      // Ignore expand() errors
    }
  }

  override gather(args: {
    denops: Denops;
    sourceParams: Params;
  }): ReadableStream<Item<ActionData>[]> {
    const cfile = this.cfile;
    const line = this.line;

    return new ReadableStream({
      async start(controller) {
        if (cfile.length == 0) {
          controller.close();
          return;
        }

        const cwd = await fn.getcwd(args.denops) as string;

        let matched = null;
        for (
          const re of [
            // NOTE: File "{path}", line {line}
            /^\s*File "(.*)", line (\d+)/,
            // NOTE: {path}({line},{col})
            /^\s*(.*)\((\d+),(\d+)\)/,
            // NOTE: {path}:{line}:{col}
            /^.*?([^: ]+)(?:[: ])(\d+)(?::(\d+))?/,
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

          // Search from findfile()
          const find = await fn.findfile(
            args.denops,
            parseMatched(matched, 1, "") as string,
            FIND_PATTERN,
          ) as string;

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
        } else {
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
        }

        controller.close();
      },
    });
  }

  override params(): Params {
    return {};
  }
}
