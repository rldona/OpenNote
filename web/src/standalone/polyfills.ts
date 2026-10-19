// Must be imported first: the server code uses the Node `Buffer` global.
import { Buffer } from 'buffer';

(globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
