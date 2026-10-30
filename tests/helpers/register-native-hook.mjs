// Registers the native-import recorder for the child process in the zero-native test.
import { register } from "node:module";

register(new URL("./record-native-imports.mjs", import.meta.url));
