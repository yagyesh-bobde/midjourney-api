import "dotenv/config";
import { Midjourney } from "../src";
import * as fs from "fs/promises";
import axios from "axios";
import path from "path";

interface Character {
  name: string;
  description: string;
  stylePrompt: string;
  referenceUrl?: string;
  selectedVariation?: string;
}

interface Scene {
  sceneNumber: number;
  description: string;
  characters: string[];
  setting: string;
  mood: string;
  cameraAngle?: string;
  action: string;
  selectedVariation?: string;
}

interface AnimeScript {
  title: string;
  style: string;
  artStyle: string;
  characters: Character[];
  scenes: Scene[];
}

interface MJResponse {
  id?: string;
  hash?: string;
  flags?: number;
  uri?: string;
  options?: Array<{
    id: string;
    hash: string;
    uri: string;
  }>;
}

class AnimeSceneGenerator {
  private client: Midjourney;
  private baseOutputDir: string;
  private characterRefs: Map<string, string> = new Map();

  constructor() {
    this.client = new Midjourney({
      ServerId: <string>process.env.SERVER_ID,
      ChannelId: <string>process.env.CHANNEL_ID,
      SalaiToken: <string>process.env.SALAI_TOKEN,
      HuggingFaceToken: <string>process.env.HUGGINGFACE_TOKEN,
      Debug: true,
      Ws: true,
    });
    this.baseOutputDir = "./anime_output";
  }

  private async createDirectoryStructure() {
    const dirs = [
      this.baseOutputDir,
      path.join(this.baseOutputDir, "characters"),
      path.join(this.baseOutputDir, "characters/variations"),
      path.join(this.baseOutputDir, "scenes"),
      path.join(this.baseOutputDir, "scenes/variations"),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  private async downloadImage(
    imageUrl: string,
    outputPath: string
  ): Promise<void> {
    try {
      const response = await axios({
        url: imageUrl,
        method: "GET",
        responseType: "arraybuffer",
      });

      await fs.writeFile(outputPath, response.data);
      console.log(`Image saved successfully to: ${outputPath}`);
    } catch (error) {
      console.error(`Error downloading image from ${imageUrl}:`, error);
    }
  }

  private buildCharacterPrompt(character: Character): string {
    return `masterpiece, high quality, anime character design, ${character.description}, ${character.stylePrompt}, full body character sheet, full body reference, multiple angles, detailed facial features, high detail, professional character design --v 6 --style raw`;
  }

  private buildScenePrompt(scene: Scene, script: AnimeScript): string {
    const characterDetails = scene.characters
      .map((charName) => {
        const char = script.characters.find((c) => c.name === charName);
        return char
          ? `${char.name} (${char.description}, ${char.stylePrompt})`
          : charName;
      })
      .join(" and ");

    // Enhanced prompt structure for better scene composition
    const prompt = [
      "masterpiece, best quality",
      characterDetails,
      scene.action,
      `in ${scene.setting}`,
      scene.mood,
      scene.cameraAngle,
      script.artStyle,
      "detailed lighting, perfect composition",
      "--ar 16:9 --v 6 --style raw",
    ]
      .filter(Boolean)
      .join(", ");

    // Add character references
    let finalPrompt = prompt;
    scene.characters.forEach((charName, index) => {
      const charRef = this.characterRefs.get(charName);
      if (charRef) {
        finalPrompt += ` --cref ${charRef}${index === 0 ? " --cw 1" : ""}`;
      }
    });

    return finalPrompt;
  }

  private async generateAndSelectVariation(
    prompt: string,
    outputName: string,
    type: "character" | "scene"
  ): Promise<MJResponse | null> {
    try {
      console.log(`Generating ${type} with prompt: ${prompt}`);

      // Generate initial image with variations
      const imagine = await this.client.Imagine(
        prompt,
        (uri: string, progress: string) => {
          console.log(`Generating ${outputName}: ${progress}%`);
        }
      );

      if (!imagine?.options || imagine.options.length === 0) {
        console.error(`Failed to generate variations for ${outputName}`);
        return null;
      }

      // Save all variations
      const variationsDir = path.join(
        this.baseOutputDir,
        type === "character" ? "characters/variations" : "scenes/variations",
        outputName
      );
      await fs.mkdir(variationsDir, { recursive: true });

      for (let i = 0; i < imagine.options.length; i++) {
        const variation = imagine.options[i];
        await this.downloadImage(
          variation.uri,
          path.join(variationsDir, `variation_${i + 1}.png`)
        );
      }

      // Select the first variation by default (can be modified to allow manual selection)
      const selectedVariation = imagine.options[0];

      // Save the selected variation to main directory
      const mainPath = path.join(
        this.baseOutputDir,
        type === "character" ? "characters" : "scenes",
        `${outputName}.png`
      );
      await this.downloadImage(selectedVariation.uri, mainPath);

      // Save metadata
      const metadataPath = path.join(
        this.baseOutputDir,
        type === "character" ? "characters" : "scenes",
        `${outputName}_metadata.json`
      );

      const metadata = {
        prompt,
        imagineId: imagine.id,
        selectedVariation: selectedVariation.id,
        allVariations: imagine.options.map((opt) => ({
          id: opt.id,
          uri: opt.uri,
        })),
        localPath: mainPath,
        timestamp: new Date().toISOString(),
      };

      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

      return {
        ...imagine,
        uri: selectedVariation.uri,
      };
    } catch (error) {
      console.error(`Error generating ${outputName}:`, error);
      return null;
    }
  }

  async generateCharacterReferences(script: AnimeScript): Promise<void> {
    console.log("Generating character references...");

    for (const character of script.characters) {
      const prompt = this.buildCharacterPrompt(character);
      const response = await this.generateAndSelectVariation(
        prompt,
        `character_${character.name.toLowerCase()}`,
        "character"
      );

      if (response?.uri) {
        this.characterRefs.set(character.name, response.uri);
        console.log(
          `Generated reference for ${character.name}: ${response.uri}`
        );
      }

      // Add delay between generations
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  async generateScenes(script: AnimeScript): Promise<void> {
    console.log("Generating scenes...");

    for (const scene of script.scenes) {
      const prompt = this.buildScenePrompt(scene, script);
      await this.generateAndSelectVariation(
        prompt,
        `scene_${scene.sceneNumber.toString().padStart(3, "0")}`,
        "scene"
      );

      // Add delay between generations
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  async generate(scriptPath: string): Promise<void> {
    try {
      const scriptContent = await fs.readFile(scriptPath, "utf-8");
      const script: AnimeScript = JSON.parse(scriptContent);

      await this.createDirectoryStructure();
      await this.client.Connect();

      await this.generateCharacterReferences(script);
      await this.generateScenes(script);

      this.client.Close();
    } catch (error) {
      console.error("Error in generate:", error);
      this.client.Close();
    }
  }
}

export default AnimeSceneGenerator;

// The script example remains the same as before
const scriptExample: AnimeScript = {
  title: "Whispers of the Heart: A High School Romance",
  style: "anime",
  artStyle:
    "soft anime art style, blend of Studio Ghibli and Makoto Shinkai, warm and dreamy lighting",
  characters: [
    {
      name: "Rin",
      description:
        "16-year-old female protagonist with short, wavy auburn hair and expressive green eyes",
      stylePrompt:
        "wearing a classic school uniform, often seen with a notebook, curious yet shy expression, gentle demeanor",
    },
    {
      name: "Kaito",
      description:
        "17-year-old male deuteragonist with tousled black hair and intense blue eyes",
      stylePrompt:
        "wearing casual school attire with a hint of rebellion, aloof expression, carries a mysterious notebook",
    },
    {
      name: "Hana",
      description:
        "Rin's cheerful best friend with long brown hair and hazel eyes",
      stylePrompt:
        "always dressed in vibrant colors, wears a hairpin, playful expression, lively demeanor",
    },
    {
      name: "Sora",
      description:
        "18-year-old senior and student council president with neat black hair and serious demeanor",
      stylePrompt:
        "wearing a formal school uniform with a badge, glasses, calm and composed expression",
    },
  ],
  scenes: [
    {
      sceneNumber: 1,
      description: "Rin stumbles upon Kaito in the library after school",
      characters: ["Rin", "Kaito"],
      setting: "quiet school library at dusk",
      mood: "curious and slightly mysterious",
      cameraAngle: "close-up of Rin’s surprised expression",
      action:
        "Rin accidentally drops a book, drawing Kaito's attention as he looks up, their eyes meeting briefly",
    },
    {
      sceneNumber: 2,
      description:
        "Kaito catches Rin on the school rooftop, gazing at the sunset",
      characters: ["Rin", "Kaito"],
      setting: "school rooftop at sunset",
      mood: "serene and introspective",
      cameraAngle: "wide shot capturing the view and Rin’s silhouette",
      action:
        "Kaito quietly approaches Rin and comments on the sunset, sparking a casual conversation",
    },
    {
      sceneNumber: 3,
      description: "Hana teases Rin about her mysterious ‘new friend’",
      characters: ["Rin", "Hana"],
      setting: "school courtyard during lunch break",
      mood: "playful and lighthearted",
      cameraAngle: "close-up of Hana’s teasing grin as Rin blushes",
      action:
        "Hana nudges Rin, making her realize she’s been thinking about Kaito more than she realized",
    },
    {
      sceneNumber: 4,
      description:
        "Sora introduces himself to Kaito, curious about his recent activities",
      characters: ["Kaito", "Sora"],
      setting: "school hallway, near the student council room",
      mood: "tense and formal",
      cameraAngle:
        "medium shot showing Sora’s composed demeanor and Kaito’s guarded expression",
      action:
        "Sora subtly warns Kaito to be mindful of his actions, hinting he’s noticed something",
    },
    {
      sceneNumber: 5,
      description: "Rin finds a hidden note in her locker",
      characters: ["Rin"],
      setting: "school hallway, near Rin’s locker",
      mood: "intriguing and suspenseful",
      cameraAngle: "close-up of Rin’s hand holding the note",
      action:
        "Rin unfolds the note, which reads: ‘Meet me by the garden after school,’ signed with a mysterious symbol",
    },
    {
      sceneNumber: 6,
      description: "Rin and Kaito meet in the hidden garden for the first time",
      characters: ["Rin", "Kaito"],
      setting:
        "a hidden rooftop garden, filled with flowers and dappled sunlight",
      mood: "magical and enchanting",
      cameraAngle: "wide shot showing the garden in full bloom",
      action:
        "Kaito leads Rin through the doorway, revealing a beautiful hidden space, leaving her in awe",
    },
    {
      sceneNumber: 7,
      description: "Hana questions Rin about her secret disappearances",
      characters: ["Rin", "Hana"],
      setting: "school cafeteria, busy with students",
      mood: "curious and probing",
      cameraAngle:
        "medium shot of Hana leaning forward with an intrigued expression",
      action:
        "Hana presses Rin to reveal her secret, but Rin laughs it off, keeping her promise to Kaito",
    },
    {
      sceneNumber: 8,
      description: "Sora confronts Kaito in the hidden garden",
      characters: ["Kaito", "Sora"],
      setting: "hidden rooftop garden in the evening",
      mood: "tense and confrontational",
      cameraAngle:
        "low angle showing Sora’s stern expression as he confronts Kaito",
      action:
        "Sora warns Kaito that he's breaking the rules by bringing someone else here, but Kaito stands his ground",
    },
    {
      sceneNumber: 9,
      description: "Rin overhears a rumor about Kaito",
      characters: ["Rin"],
      setting: "school hallway, filled with students chatting",
      mood: "surprised and conflicted",
      cameraAngle: "close-up of Rin’s face showing mixed emotions",
      action:
        "Rin overhears classmates gossiping about Kaito’s ‘dark past,’ making her question their friendship",
    },
    {
      sceneNumber: 10,
      description: "Kaito reassures Rin in the hidden garden",
      characters: ["Rin", "Kaito"],
      setting: "hidden rooftop garden at dusk, with a soft glow in the air",
      mood: "gentle and reassuring",
      cameraAngle: "close-up of Kaito’s hand reaching out to Rin’s",
      action:
        "Kaito confides in Rin, sharing his past and reassuring her of his intentions",
    },
    {
      sceneNumber: 11,
      description: "Rin and Kaito share a heartfelt moment under the stars",
      characters: ["Rin", "Kaito"],
      setting: "rooftop garden at night, with stars visible above",
      mood: "romantic and intimate",
      cameraAngle: "wide shot showing both of them gazing at the stars",
      action:
        "Kaito points out constellations, and they share a quiet, intimate moment",
    },
    {
      sceneNumber: 12,
      description: "Sora warns Rin to stay away from Kaito",
      characters: ["Rin", "Sora"],
      setting: "empty classroom after school",
      mood: "tense and serious",
      cameraAngle: "medium shot of Sora’s serious expression",
      action:
        "Sora advises Rin to keep her distance from Kaito, hinting at potential danger",
    },
    {
      sceneNumber: 13,
      description: "Hana discovers the hidden garden and confronts Rin",
      characters: ["Rin", "Hana"],
      setting: "hidden rooftop garden, lush and peaceful",
      mood: "confrontational but caring",
      cameraAngle: "close-up of Hana’s hurt expression",
      action:
        "Hana feels betrayed for being kept out of the secret, but Rin reassures her",
    },
    {
      sceneNumber: 14,
      description: "Kaito defends Rin from a group of classmates",
      characters: ["Kaito", "Rin"],
      setting: "school courtyard, crowded with students",
      mood: "tense and protective",
      cameraAngle: "wide shot showing Kaito standing between Rin and the group",
      action:
        "Kaito steps in to protect Rin from classmates’ harsh words, showing his loyalty",
    },
    {
      sceneNumber: 15,
      description: "Sora and Kaito come to an understanding",
      characters: ["Kaito", "Sora"],
      setting: "hidden rooftop garden at dusk",
      mood: "respectful and conciliatory",
      cameraAngle: "close-up of both characters shaking hands",
      action:
        "After a heartfelt talk, Sora acknowledges Kaito’s feelings for Rin and steps back",
    },
    {
      sceneNumber: 16,
      description: "Rin and Kaito share a fun day at the school festival",
      characters: ["Rin", "Kaito", "Hana", "Sora"],
      setting: "school festival, lively and bustling with activity",
      mood: "joyful and carefree",
      cameraAngle: "wide shot capturing the festival atmosphere",
      action:
        "The group enjoys games and food stalls, strengthening their bond",
    },
    {
      sceneNumber: 17,
      description: "Rin realizes her feelings for Kaito",
      characters: ["Rin"],
      setting: "her bedroom, with a view of the moon from the window",
      mood: "reflective and romantic",
      cameraAngle: "close-up of Rin’s expression as she gazes at the moon",
      action:
        "Rin reflects on her memories with Kaito and finally understands her feelings",
    },
    {
      sceneNumber: 18,
      description: "Kaito leaves a final note in Rin’s locker",
      characters: ["Rin", "Kaito"],
      setting: "school hallway, with Rin standing by her locker",
      mood: "mysterious and anticipatory",
      cameraAngle: "close-up of Rin’s hand opening the note",
      action: "The note reads: ‘Meet me at the garden, one last time.’",
    },
    {
      sceneNumber: 19,
      description: "Rin and Kaito confess their feelings",
      characters: ["Rin", "Kaito"],
      setting: "hidden rooftop garden at night, under a sky full of stars",
      mood: "romantic and tender",
      cameraAngle: "close-up of both characters holding hands",
      action:
        "Rin and Kaito share their feelings, sealing their bond under the stars",
    },
    {
      sceneNumber: 20,
      description:
        "The four friends gather in the hidden garden, promising to keep it a secret",
      characters: ["Rin", "Kaito", "Hana", "Sora"],
      setting: "hidden rooftop garden in the morning light",
      mood: "warm and hopeful",
      cameraAngle:
        "wide shot capturing all four friends in the garden, smiling",
      action:
        "They promise to keep the garden their special place, preserving the magic of their friendship",
    },
  ],
};

// Save example script to file
async function saveExampleScript() {
  await fs.writeFile(
    "./anime_script.json",
    JSON.stringify(scriptExample, null, 2)
  );
}

async function main() {
  await saveExampleScript();
  const generator = new AnimeSceneGenerator();
  await generator.generate("./anime_script.json");
}

main().catch(console.error);
