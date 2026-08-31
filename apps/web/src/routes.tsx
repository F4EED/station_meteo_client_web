import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { DialogManager } from "@components/Dialog/DialogManager.tsx";
import type { useAppStore } from "@core/stores";
import { Connections } from "@pages/Connections/index.tsx";
import MeteoPage from "@pages/Meteo/index.tsx";
import ConfigPage from "@pages/Settings/index.tsx";
import type { useTranslation } from "react-i18next";
import { App } from "./App.tsx";

interface AppContext {
  stores: {
    app: ReturnType<typeof useAppStore>;
  };
  i18n: ReturnType<typeof useTranslation>;
}

export const rootRoute = createRootRouteWithContext<AppContext>()({
  component: () => <App />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Connections,
  loader: () => {
    return redirect({ to: "/meteo", replace: true });
  },
});

const meteoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/meteo",
  component: MeteoPage,
});

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: ConfigPage,
});

export const radioRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "radio",
  component: ConfigPage,
});

export const deviceRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "device",
  component: ConfigPage,
});

export const moduleRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "module",
  component: ConfigPage,
});

export const rangeRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "range",
  component: ConfigPage,
});

const dialogWithParamsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dialog/$dialogId",
  component: DialogManager,
});

const connectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connections",
  component: Connections,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  meteoRoute,
  settingsRoute.addChildren([radioRoute, deviceRoute, moduleRoute, rangeRoute]),
  dialogWithParamsRoute,
  connectionsRoute,
]);

const router = createRouter({
  routeTree,
  context: {
    stores: {
      app: {} as ReturnType<typeof useAppStore>,
    },
    i18n: {} as ReturnType<typeof import("react-i18next").useTranslation>,
  },
});
export { router };
