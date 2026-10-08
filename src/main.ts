import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { session } from "./store";
import "./styles/app.css";

// Boot the session before mounting: the router guard needs to know whether
// the visitor is signed in, and the shell renders the account menu from the
// same state.
session.load().finally(() => {
  createApp(App).use(router).mount("#app");
});
