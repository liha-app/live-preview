# @liha-cli/webmcp

Publishes a page's tools to an agent in the same browser, through
[WebMCP](https://github.com/webmachinelearning/webmcp).

```ts
import { registerLihaTools } from '@liha-cli/webmcp';

const registration = registerLihaTools({/* handlers */});
registration.dispose();
```

Written for [Liha Live Preview](https://github.com/liha-app/live-preview), where
it lets an agent read a review, scroll the human's screen to a comment, resize
the preview and answer in the thread — in the page the human is looking at,
rather than through an API somewhere else.

It handles the shapes the imperative API has taken so far, validates arguments
against the schema each tool publishes (browsers do not), and says plainly when
the browser has no WebMCP support rather than failing quietly.
