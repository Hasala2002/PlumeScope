import "dotenv/config";
import express from "express";
import cors from "cors";
import { health } from "./routes/health.js";
import { sites } from "./routes/sites.js";
import { score } from "./routes/score.js";
import { hazards } from "./routes/hazards.js";
import { plume } from "./routes/plume.js";
import { optimize } from "./routes/optimize.js";
import { miniClimate } from "./routes/miniClimate.js";
import { geo } from "./routes/geo.js";
import { twin } from "./routes/twin.js";
import { population } from "./routes/population.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/health", health);
app.use("/sites", sites);
app.use("/score", score);
app.use("/hazards", hazards);
app.use("/plume", plume);
app.use("/optimize", optimize);
app.use("/mini-climate", miniClimate);
app.use("/geo", geo);
app.use("/twin", twin);
app.use("/population", population);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
