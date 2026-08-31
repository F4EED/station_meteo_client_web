import { expect, test } from "../fixtures/test.ts";

test("connects to a real device over HTTPS and reaches the weather view", async ({
  page,
  connectionPage,
  device,
}) => {
  await connectionPage.connectHttp({ host: device.host, tls: device.tls });
  await expect(page.getByTestId("station-meteo")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page).toHaveURL(/\/meteo/);
});
