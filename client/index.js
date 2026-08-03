import { registerRootComponent } from "expo";

// Defines the background update-check task. Must be imported unconditionally
// here, at the entry point, so it's registered even when the OS launches the
// app headlessly (no component ever mounts) to run the scheduled task.
import "@/lib/update-checker";
import App from "@/App";

registerRootComponent(App);
