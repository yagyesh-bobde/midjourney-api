import "dotenv/config";
import { Midjourney } from "../src";
import fs from "fs/promises";
import path from "path";

// Progress tracking interface
interface ProgressState {
  completedCharacters: string[];
  completedScenes: string[];
}

// Story and scene definitions
const story = {
  title: "Seasons of the Heart",
  artStyle:
    "Generate a photo-realistic image with ultra-high detail and cinematic lighting, capturing lifelike skin textures, natural expressions, and realistic shadows. Aim for a sharp, DSLR-quality look that emphasizes authentic human features and rich color tones.",
  mainCharacters: [
    {
      name: "Zoey",
      description:
        "A beautiful woman in her early thirties with tired eyes and worry lines. Professional attire suggesting her career as an interior designer. Exhausted but determined expression.",
      prompt:
        "Beautiful woman in early thirties, tired eyes, professional attire, exhausted but determined expression, interior designer appearance --style raw --ar 1:1 --v 6",
    },
    {
      name: "Blaine",
      description:
        "A handsome surgeon in his mid-thirties wearing professional medical attire. Charismatic appearance with subtle signs of emotional pain. Wealthy and sophisticated demeanor.",
      prompt:
        "Handsome male surgeon in mid-thirties, sophisticated appearance, professional medical attire, charismatic yet melancholic expression --style raw --ar 1:1 --v 6",
    },
    {
      name: "Max",
      description:
        "A brave four-year-old boy with pale skin due to illness. Bright eyes full of hope despite medical equipment around him. Gentle smile and thinning hair.",
      prompt:
        "Four-year-old boy with pale skin, bright hopeful eyes, gentle smile, thinning hair, medical patient appearance --style raw --ar 1:1 --v 6",
    },
    {
      name: "Sophia",
      description:
        "A beautiful woman in her early thirties from a wealthy background. Initially kind appearance masking growing inner conflict. Sophisticated and well-dressed.",
      prompt:
        "Beautiful sophisticated woman in early thirties, wealthy appearance, kind face with hint of inner conflict, designer clothing --style raw --ar 1:1 --v 6",
    },
    {
      name: "Mother",
      description:
        "A kind and worried woman in her late fifties. Gentle features with concern etched on her face. Casual but elegant attire.",
      prompt:
        "Kind worried woman in late fifties, gentle features, concerned expression, casual elegant clothing --style raw --ar 1:1 --v 6",
    },
  ],
  scenes: [
    {
      title: "The Passionate Reunion",
      prompt: (charRefs) =>
        `Intimate hospital room setting, Zoey (wearing professional attire, vulnerable expression) turning away from Blaine (in doctor's coat, intense gaze). Tension-filled atmosphere with medical equipment in background, dramatic shadows emphasizing their emotional connection, warm lighting highlighting their faces. Close physical proximity suggesting unresolved feelings --cref ${charRefs.Zoey} ${charRefs.Blaine} --ar 1:1 --v 6`,
    },
    {
      title: "The Necklace Confrontation",
      prompt: (charRefs) =>
        `Night scene at Blaine's doorstep, Zoey (distressed, desperate expression) facing Blaine (conflicted, holding a meaningful necklace). Dramatic porch lighting casting shadows on their faces, urban background with city lights, emphasis on the emotional tension between them --cref ${charRefs.Zoey} ${charRefs.Blaine} --ar 1:1 --v 6`,
    },
    {
      title: "Sofia's Discovery",
      prompt: (charRefs) =>
        `Elegant living room, Sofia (wearing the contested necklace, defiant expression) confronting Blaine (tense, angry stance). Rich interior decor reflecting wealth, dramatic lighting emphasizing the conflict, focus on the necklace around Sofia's neck --cref ${charRefs.Sophia} ${charRefs.Blaine} --ar 1:1 --v 6`,
    },
    {
      title: "The Secret Escape",
      prompt: (charRefs) =>
        `Hospital corridor at night, Blaine (in doctor's coat, gentle expression) crouching down to Max's level (pale but excited young patient in hospital gown). Warm lighting from overhead, medical equipment in background, intimate moment between them as they plan their adventure --cref ${charRefs.Blaine} ${charRefs.Max} --ar 1:1 --v 6`,
    },
    {
      title: "The Pet Store Mission",
      prompt: (charRefs) =>
        `Colorful pet store interior, Blaine (caring expression, casual clothes) helping Max (excited despite illness, wearing comfortable clothes) choose a pet. Vibrant display of animal cages and supplies, warm lighting emphasizing their bonding moment --cref ${charRefs.Blaine} ${charRefs.Max} --ar 1:1 --v 6`,
    },
    {
      title: "Mother's Comfort",
      prompt: (charRefs) =>
        `Hospital waiting area, Zoey (exhausted, emotional) being comforted by her mother (concerned, supportive stance). Soft ambient lighting, medical facility backdrop, focus on their emotional interaction as they discuss Max's treatment --cref ${charRefs.Zoey} ${charRefs.Mother} --ar 1:1 --v 6`,
    },
    {
      title: "The Shocking Discovery",
      prompt: (charRefs) =>
        `Hospital hallway intersection, Zoey (frozen in shock) witnessing Blaine (protective stance) with Max (happy despite illness). Medical equipment and signage visible, dramatic lighting highlighting Zoey's realization, multiple perspective view capturing all three characters' expressions --cref ${charRefs.Zoey} ${charRefs.Blaine} ${charRefs.Max} --ar 1:1 --v 6`,
    },
  ],
};

async function loadProgress(): Promise<ProgressState> {
  try {
    const data = await fs.readFile(
      path.join("output", "progress.json"),
      "utf-8"
    );
    return JSON.parse(data);
  } catch (error) {
    return {
      completedCharacters: [],
      completedScenes: [],
    };
  }
}

async function saveProgress(progress: ProgressState) {
  await fs.writeFile(
    path.join("output", "progress.json"),
    JSON.stringify(progress, null, 2)
  );
}

async function ensureDirectories() {
  const dirs = ["output/character_images", "output/scene_images"];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function downloadImage(url: string, filepath: string) {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  await fs.writeFile(filepath, Buffer.from(buffer));
  console.log(`Downloaded image to ${filepath}`);
}

async function generateCharacter(client: Midjourney, character: any) {
  console.log(`Generating character: ${character.name}`);
  const result = await client.Imagine(
    character.prompt,
    (uri: string, progress: string) => {
      console.log(`${character.name} generation progress:`, progress);
    }
  );

  if (!result) {
    throw new Error(`Failed to generate character ${character.name}`);
  }

  const upscaled = await client.Upscale({
    index: 1,
    msgId: result.id,
    hash: result.hash,
    flags: result.flags,
    loading: (uri: string, progress: string) => {
      console.log(`${character.name} upscale progress:`, progress);
    },
  });

  if (!upscaled?.uri) {
    throw new Error(`Failed to upscale character ${character.name}`);
  }

  const filepath = path.join(
    "output/character_images",
    `${character.name}.png`
  );
  await downloadImage(upscaled.uri, filepath);

  return {
    uri: upscaled.uri,
    filepath,
  };
}

async function generateScene(
  client: Midjourney,
  scene: any,
  characterRefs: Record<string, string>
) {
  console.log(`Generating scene: ${scene.title}`);

  const prompt = scene.prompt(characterRefs);
  console.log(`Scene prompt: ${prompt}`);

  const result = await client.Imagine(
    prompt,
    (uri: string, progress: string) => {
      console.log(`${scene.title} generation progress:`, progress);
    }
  );

  if (!result) {
    throw new Error(`Failed to generate scene ${scene.title}`);
  }

  const upscaled = await client.Upscale({
    index: 1,
    msgId: result.id,
    hash: result.hash,
    flags: result.flags,
    loading: (uri: string, progress: string) => {
      console.log(`${scene.title} upscale progress:`, progress);
    },
  });

  if (!upscaled?.uri) {
    throw new Error(`Failed to upscale scene ${scene.title}`);
  }

  const filepath = path.join("output/scene_images", `${scene.title}.png`);
  await downloadImage(upscaled.uri, filepath);

  return filepath;
}

async function main() {
  await ensureDirectories();
  const progress = await loadProgress();

  const client = new Midjourney({
    ServerId: <string>process.env.SERVER_ID,
    ChannelId: <string>process.env.CHANNEL_ID,
    SalaiToken: <string>process.env.SALAI_TOKEN,
    HuggingFaceToken: <string>process.env.HUGGINGFACE_TOKEN,
    Debug: true,
    Ws: true,
  });

  await client.Connect();

  try {
    const characterRefs: Record<string, string> = {};
    const characterFiles: Record<string, string> = {};

    // Load existing character references if available
    try {
      const existingRefs = JSON.parse(
        await fs.readFile(
          path.join("output", "character_references.json"),
          "utf-8"
        )
      );
      Object.assign(characterRefs, existingRefs.uris);
      Object.assign(characterFiles, existingRefs.files);
    } catch (error) {
      console.log("No existing character references found, starting fresh");
    }

    // Generate remaining characters
    for (const character of story.mainCharacters) {
      if (!progress.completedCharacters.includes(character.name)) {
        const result = await generateCharacter(client, character);
        characterRefs[character.name] = result.uri;
        characterFiles[character.name] = result.filepath;
        progress.completedCharacters.push(character.name);
        await saveProgress(progress);
        console.log(`Generated ${character.name}:`, {
          uri: result.uri,
          filepath: result.filepath,
        });
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } else {
        console.log(`Skipping already generated character: ${character.name}`);
      }
    }

    // Generate remaining scenes
    for (const scene of story.scenes) {
      if (!progress.completedScenes.includes(scene.title)) {
        const filepath = await generateScene(client, scene, characterRefs);
        progress.completedScenes.push(scene.title);
        await saveProgress(progress);
        console.log(`Generated scene ${scene.title} at ${filepath}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } else {
        console.log(`Skipping already generated scene: ${scene.title}`);
      }
    }

    // Save final character references
    await fs.writeFile(
      path.join("output", "character_references.json"),
      JSON.stringify(
        {
          uris: characterRefs,
          files: characterFiles,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error("Error generating storyboard:", error);
  } finally {
    client.Close();
  }
}

main().catch(console.error);
