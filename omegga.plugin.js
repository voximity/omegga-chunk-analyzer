const COLLIDERS = require("./colliders");
const CHUNK_SIZE = 102.4 * 10;
const CHUNK_LIMIT = 65000;
const MARKER_OWNER = {id: "00000000-0000-0000-0000-000000000001", name: "Chunk Marker"};
const CHUNK_CORNERS = [
    [-CHUNK_SIZE / 2 + 1, -CHUNK_SIZE / 2 + 1, -CHUNK_SIZE / 2 + 1],
    [ CHUNK_SIZE / 2 - 1, -CHUNK_SIZE / 2 + 1, -CHUNK_SIZE / 2 + 1],
    [-CHUNK_SIZE / 2 + 1,  CHUNK_SIZE / 2 - 1, -CHUNK_SIZE / 2 + 1],
    [ CHUNK_SIZE / 2 - 1,  CHUNK_SIZE / 2 - 1, -CHUNK_SIZE / 2 + 1],
    [-CHUNK_SIZE / 2 + 1, -CHUNK_SIZE / 2 + 1,  CHUNK_SIZE / 2 - 1],
    [ CHUNK_SIZE / 2 - 1, -CHUNK_SIZE / 2 + 1,  CHUNK_SIZE / 2 - 1],
    [-CHUNK_SIZE / 2 + 1,  CHUNK_SIZE / 2 - 1,  CHUNK_SIZE / 2 - 1],
    [ CHUNK_SIZE / 2 - 1,  CHUNK_SIZE / 2 - 1,  CHUNK_SIZE / 2 - 1]
];
const MARKER_COLORS = [
    [255, 255, 255],
    [0, 180, 0],
    [255, 0, 0]
];

module.exports = class ChunkAnalyzer {
    constructor(omegga, config, store) {
        this.omegga = omegga;
        this.config = config;
        this.store = store;
    }

    positionToChunk(x, y, z) {
        return [x, y, z].map((n) => Math.floor(n / CHUNK_SIZE));
    }

    chunkCenter(cx, cy, cz) {
        return [CHUNK_SIZE / 2 + cx * CHUNK_SIZE, CHUNK_SIZE / 2 + cy * CHUNK_SIZE, CHUNK_SIZE / 2 + cz * CHUNK_SIZE];
    }

    formatChunk(cx, cy, cz) {
        return `<color="0a0">[${cx}, ${cy}, ${cz}]</>`;
    }

    async markChunks(chunks) {
        const bricks = [];

        for (const [cx, cy, cz, col] of chunks) {
            const center = this.chunkCenter(cx, cy, cz);

            for (var i = 0; i < 8; i++) {
                const brick = {
                    owner_index: 1,
                    asset_name_index: 0,
                    material_index: 0,
                    material_intensity: 5,
                    color: MARKER_COLORS[col],
                    size: [1, 1, 1],
                    position: CHUNK_CORNERS[i].map((n, j) => n + center[j])
                };

                bricks.push(brick);
            }
        }

        const save = {brick_assets: ["PB_DefaultMicroBrick"], materials: ["BMC_Glow"], brick_owners: [MARKER_OWNER], bricks};
        await this.omegga.loadSaveData(save, {quiet: true});
    }

    async markChunk(...chunk) {
        await this.markChunks([chunk]);
    }

    analyzeSave(save) {
        if (save == null) throw "No save loaded!";
        if (save.bricks.length == 0) throw "No bricks in save!";

        const chunks = {};

        for (var i = 0; i < save.bricks.length; i++) {
            const brick = save.bricks[i];
            const chunkPos = this.positionToChunk(...brick.position);
            const key = `${chunkPos[0]},${chunkPos[1]},${chunkPos[2]}`
            const fetchedColliderCount = COLLIDERS[save.brick_assets[brick.asset_name_index]];
            const colliderCount = fetchedColliderCount == null || isNaN(fetchedColliderCount) ? 1 : fetchedColliderCount;
            if (chunks[key] != null) {
                chunks[key][0]++;
                chunks[key][1] += colliderCount;
            } else
                chunks[key] = [1, colliderCount];
        }

        return chunks;
    }

    userIsAuthed(user) {
        return this.omegga.getPlayer(user).isHost() || this.config.authorized.some((p) => p.name == user);
    }

    async init() {
        this.save = null;
        this.analyzed = null;

        this.omegga.on("cmd:analyzechunks", async (name) => {
            if (!this.userIsAuthed(name)) return;

            this.omegga.whisper(name, "Analyzing save...");
            try {
                this.save = await this.omegga.getSaveData();
                this.analyzed = this.analyzeSave(this.save);
                this.omegga.whisper(name, `<color="0a0">The save has been analyzed. Any subsequent changes must be reanalyzed.</>`);
            } catch (e) {
                this.omegga.whisper(name, `<color="a00">An error occured while analyzing!</> <code>${e}</>`);
            }
        });

        this.omegga.on("cmd:chunkcount", async (name) => {
            if (this.analyzed == null) {
                this.omegga.whisper(name, `<color="a00">The save has not been analyzed!</> Analyze it first with <code>/analyzechunks</>.`);
                return;
            }

            const player = this.omegga.getPlayer(name);
            const pos = await player.getPosition();
            const chunkPos = this.positionToChunk(...pos);
            const chunkCount = this.analyzed[chunkPos] || [0, 0];

            if (chunkCount[0] <= 0)
                this.omegga.whisper(name, `There are no bricks in this chunk, ${this.formatChunk(...chunkPos)}.`);
            else {
                this.omegga.whisper(name, `There are <color="0a0">${chunkCount[0]} bricks</> and <color="${chunkCount[1] <= CHUNK_LIMIT ? "0a0" : "a00"}">${chunkCount[1]} colliders</> in this chunk, ${this.formatChunk(...chunkPos)}.`);
                if (chunkCount[1] > CHUNK_LIMIT) this.omegga.whisper(name, `<color="a00">This chunk has exceeded its limit in colliders! Some bricks will not collide correctly.</>`);
            }
        })

        this.omegga.on("cmd:chunk", async (name) => {
            const player = this.omegga.getPlayer(name);
            const pos = await player.getPosition();
            const chunkPos = this.positionToChunk(...pos);
            this.omegga.whisper(name, `You are currently in chunk ${this.formatChunk(...chunkPos)}.`);
        });

        this.omegga.on("cmd:markchunk", async (name) => {
            if (!this.userIsAuthed(name)) return;

            const player = this.omegga.getPlayer(name);
            const pos = await player.getPosition();
            const chunkPos = this.positionToChunk(...pos);
            if (this.analyzed == null || this.analyzed[chunkPos] == null) await this.markChunk(...chunkPos, 0);
            else await this.markChunk(...chunkPos, this.analyzed[chunkPos][1] <= CHUNK_LIMIT ? 1 : 2);
            this.omegga.whisper(name, `Chunk corners have been marked.`);
        });

        this.omegga.on("cmd:markchunks", async (name) => {
            if (!this.userIsAuthed(name)) return;

            if (this.analyzed == null) {
                this.omegga.whisper(name, `<color="a00">The save has not been analyzed!</> Analyze it first with <code>/analyzechunks</>.`);
                return;
            }

            const chunksToMark = Object.entries(this.analyzed).filter(([cp, cd]) => cd[0] > 0).map(([cp, cd]) => JSON.parse(`[${cp}, ${cd[1] <= CHUNK_LIMIT ? 1 : 2}]`)); // LOL
            await this.markChunks(chunksToMark);

            this.omegga.whisper(name, `All chunk corners have been marked.`);
        });

        return {registeredCommands: ["chunk", "analyzechunks", "chunkcount", "markchunk", "markchunks"]};
    }

    async stop() {}
}
