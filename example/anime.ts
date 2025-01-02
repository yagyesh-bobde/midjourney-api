import "dotenv/config";
import { Midjourney } from "../src";
import * as fs from "fs/promises";
import * as path from "path";

interface Character {
  name: string;
  description: string;
  stylePrompt: string;
  referenceImage?: string; // Store the generated reference image path
}

interface Scene {
  sceneNumber: number;
  description: string;
  characters: string[];
  setting: string;
  mood: string;
  cameraAngle?: string;
  action: string;
}

export interface AnimeScript {
  title: string;
  style: string;
  artStyle: string;
  characters: Character[];
  scenes: Scene[];
}

class AnimeSceneGenerator {
  private client: Midjourney;
  private outputDir: string;

  constructor() {
    this.client = new Midjourney({
      ServerId: <string>process.env.SERVER_ID,
      ChannelId: <string>process.env.CHANNEL_ID,
      SalaiToken: <string>process.env.SALAI_TOKEN,
      HuggingFaceToken: <string>process.env.HUGGINGFACE_TOKEN,
      Debug: true,
      Ws: true,
    });
    this.outputDir = "./anime_output";
  }

  private async createOutputDirectory() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error("Error creating output directory:", error);
    }
  }

  private buildCharacterPrompt(character: Character): string {
    return `${character.description}, ${character.stylePrompt}, full body character reference sheet, character design, high detail --v 6 --style raw`;
  }

  private buildScenePrompt(
    scene: Scene,
    script: AnimeScript,
    characterRefs: string[]
  ): string {
    const characterPrompts = scene.characters
      .map((charName) => {
        const char = script.characters.find((c) => c.name === charName);
        return char ? `${char.name} ${char.description}` : charName;
      })
      .join(", ");

    // Build the base prompt
    let prompt = `${scene.action}, ${scene.setting}, ${
      scene.mood
    }, ${characterPrompts}, ${scene.cameraAngle || ""}, ${
      script.artStyle
    }, highly detailed, professional lighting --ar 16:9 --v 6 --style raw`;

    // Add character references
    characterRefs.forEach((ref, index) => {
      prompt += ` --cref ${ref}`;
    });

    // Add style reference from the first generated image if it exists
    if (scene.sceneNumber > 1) {
      const firstSceneRef = path.join(this.outputDir, "scene_001.png");
      if (fs.existsSync(firstSceneRef)) {
        prompt += ` --sref ${firstSceneRef}`;
      }
    }

    return prompt;
  }

  private async generateImage(
    prompt: string,
    outputPath: string
  ): Promise<string | null> {
    try {
      const imagine = await this.client.Imagine(
        prompt,
        (uri: string, progress: string) => {
          console.log(`Generating image: ${progress}%`);
        }
      );

      if (!imagine) {
        console.error("Failed to generate image");
        return null;
      }

      // Upscale the first variation for best quality
      const upscale = await this.client.Upscale({
        index: 1,
        msgId: <string>imagine.id,
        hash: <string>imagine.hash,
        flags: imagine.flags,
        loading: (uri: string, progress: string) => {
          console.log(`Upscaling image: ${progress}%`);
        },
      });

      // Save metadata
      const metadata = {
        prompt,
        imagineId: imagine.id,
        upscaleId: upscale?.id,
        timestamp: new Date().toISOString(),
      };

      await fs.writeFile(
        `${outputPath}.json`,
        JSON.stringify(metadata, null, 2)
      );

      console.log(`Generated image saved: ${outputPath}`);
      return `${outputPath}.png`; // Return the path of the generated image
    } catch (error) {
      console.error("Error generating image:", error);
      return null;
    }
  }

  async generateCharacterReferences(
    script: AnimeScript
  ): Promise<Map<string, string>> {
    const characterRefs = new Map<string, string>();

    for (const character of script.characters) {
      const prompt = this.buildCharacterPrompt(character);
      const outputPath = `${
        this.outputDir
      }/character_${character.name.toLowerCase()}`;
      const imagePath = await this.generateImage(prompt, outputPath);
      if (imagePath) {
        characterRefs.set(character.name, imagePath);
      }
    }

    return characterRefs;
  }

  async generateScenes(
    script: AnimeScript,
    characterRefs: Map<string, string>
  ): Promise<void> {
    for (const scene of script.scenes) {
      // Get relevant character references for this scene
      const relevantRefs = scene.characters
        .map((charName) => characterRefs.get(charName))
        .filter((ref): ref is string => ref !== undefined);

      const prompt = this.buildScenePrompt(scene, script, relevantRefs);
      const outputPath = `${this.outputDir}/scene_${scene.sceneNumber
        .toString()
        .padStart(3, "0")}`;
      await this.generateImage(prompt, outputPath);

      // Wait a bit between generations to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  async generate(scriptPath: string): Promise<void> {
    try {
      const scriptContent = await fs.readFile(scriptPath, "utf-8");
      const script: AnimeScript = JSON.parse(scriptContent);

      await this.createOutputDirectory();
      await this.client.Connect();

      console.log("Generating character references...");
      const characterRefs = await this.generateCharacterReferences(script);

      console.log("Generating scenes...");
      await this.generateScenes(script, characterRefs);

      this.client.Close();
    } catch (error) {
      console.error("Error in generate:", error);
      this.client.Close();
    }
  }
}


export default AnimeSceneGenerator;
