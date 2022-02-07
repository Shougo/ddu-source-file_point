import {
  BaseSource,
  Item,
} from "https://deno.land/x/ddu_vim@v0.7.2/types.ts#^";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v0.7.2/deps.ts#^";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.1.0/file.ts#^";
import { isAbsolute, join } from "https://deno.land/std@0.123.0/path/mod.ts";

type Params = Record<string, never>;

export class Source extends BaseSource<Params> {
  kind = "file";

  line = "";
  cfile = "";

  async onInit(args: {
    denops: Denops;
  }): Promise<void> {
    this.line = await fn.getline(args.denops, ".");

    try {
      this.cfile = await fn.expand(args.denops, "<cfile>") as string;
    } catch (_: unknown) {
      // Ignore expand() errors
    }
  }

  gather(args: {
    denops: Denops;
    sourceParams: Params;
  }): ReadableStream<Item<ActionData>[]> {
    const cfile = this.cfile;
    const line = this.line;

    return new ReadableStream({
      async start(controller) {
        const cwd = await fn.getcwd(args.denops) as string;
        const re = /^.*?([^: ]+):(\d+)(?::(\d+))?/;
        const matched = line.match(re);

        const exists = async (filename: string) => {
          try {
            const stat = await Deno.stat(filename);
            return stat.isFile;
          } catch (_) {
            return false;
          }
        };

        if (matched) {
          const parseMatched = (
            ary: string[],
            index: number,
            def: number | string,
          ) => {
            return ary[index] ? ary[index] : def;
          };

          const path = parseMatched(matched, 1, "") as string;
          const fullPath = isAbsolute(path) ? path : join(cwd, path);

          // Only exists the file
          if (await exists(fullPath)) {
            controller.enqueue([
              {
                word: matched[0],
                action: {
                  path: fullPath,
                  lineNr: Number(parseMatched(matched, 2, 0)),
                  col: Number(parseMatched(matched, 3, 0)),
                },
              },
            ]);
          }
        }

        const fullPath = isAbsolute(cfile) ? cfile : join(cwd, cfile);
        if (cfile != "" && await exists(fullPath)) {
          controller.enqueue(
            [{ word: cfile, action: { path: fullPath } }],
          );
        } else if (new RegExp("^https?://").test(cfile)) {
          controller.enqueue(
            [{ word: cfile, action: { path: cfile } }],
          );
        }

        controller.close();
      },
    });
  }

  params(): Params {
    return {};
  }
}
