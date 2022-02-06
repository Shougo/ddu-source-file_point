import {
  BaseSource,
  Item,
} from "https://deno.land/x/ddu_vim@v0.7.2/types.ts#^";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v0.7.2/deps.ts#^";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.1.0/file.ts#^";

type Params = Record<string, never>;

export class Source extends BaseSource<Params> {
  kind = "file";

  line = "";
  cfile = "";

  async onInit(args: {
    denops: Denops;
  }): Promise<void> {
    this.line = await fn.getline(args.denops, ".");

    // Ignore expand() errors
    try {
      this.cfile = await fn.expand(args.denops, "<cfile>") as string;
    } catch (e: unknown) {
    }
  }

  gather(args: {
    denops: Denops;
    sourceParams: Params;
  }): ReadableStream<Item<ActionData>[]> {
    const cfile = this.cfile;

    console.log(cfile);
    return new ReadableStream({
      async start(controller) {
        if (new RegExp("^https?://").test(cfile)) {
          controller.enqueue(
            [{ word: cfile, action: { path: cfile }}]
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
