import React, {
  useState,
  useEffect,
  useRef,
  Dispatch,
  SetStateAction,
} from "react";
import { StyleSheet, View, Text, Button, Image } from "react-native";
import { CameraView } from "expo-camera";
import { ExpoWebGLRenderingContext, GLView } from "expo-gl";
import { Asset } from "expo-asset";
import * as ImagePicker from "expo-image-picker";

export default function ShaderTest() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isBlurry, setIsBlurry] = useState<boolean | null>(null);
  const [brightnessStatus, setBrightnessStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  const takePicture = async () => {
    let result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 1,
    });

    if (!result.canceled) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });

    if (!result.canceled) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const ref = useRef<GLView>(null);

  if (hasPermission === null) {
    return (
      <View style={styles.container}>
        <Text>Requesting permissions…</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.container}>
        <Text>No access to camera.</Text>
      </View>
    );
  }

  if (!photoUri) {
    return (
      <View style={styles.container}>
        <CameraView style={{ flex: 1 }} />
        <View
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            padding: 20,
            backgroundColor: "black",
          }}
        >
          <Button title="Pick an image from camera roll" onPress={pickImage} />
          <Button title="Take Photo" onPress={takePicture} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GLView
        ref={ref}
        style={styles.gl}
        onContextCreate={(gl) =>
          onContextCreate(gl, photoUri, setBrightnessStatus, setIsBlurry)
        }
      />

      <Image source={{ uri: photoUri }} resizeMode="contain" style={{ flex: 1 }} />
      <Text style={styles.infoText}>
        {isBlurry === null
          ? "Processing..."
          : isBlurry
          ? "The image is blurry."
          : "The image is sharp."}
      </Text>
      <Text style={styles.infoText}>
        {isBlurry === null
          ? "Processing..."
          : brightnessStatus === "too dark"
          ? "The image is too dark."
          : brightnessStatus === "too light"
          ? "The image is too light."
          : "The image has normal brightness."}
      </Text>
      <View style={{ padding: 20, paddingTop: 0 }}>
        <Button
          title="Retake Photo"
          onPress={() => {
            setPhotoUri(null);
            setIsBlurry(null);
          }}
        />
      </View>
    </View>
  );
}

/**
 * This function loads the captured image as a texture, applies a Laplacian filter via a fragment shader,
 * and then computes the variance of the edge intensities to decide if the image is blurry.
 */
export async function onContextCreate(
  gl: ExpoWebGLRenderingContext,
  photoUri: string,
  setBrightnessStatus: Dispatch<SetStateAction<string | null>>,
  setIsBlurry: Dispatch<SetStateAction<boolean | null>>
) {
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  gl.viewport(0, 0, width, height);

  // Load the image asset from the captured photo.
  const asset = Asset.fromURI(photoUri);
  await asset.downloadAsync();

  // Create texture from the asset.
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    asset as unknown as HTMLImageElement
  );
  gl.bindTexture(gl.TEXTURE_2D, null);

  // ======================================================
  // PASS 1: Render original image with a pass-through shader
  // ======================================================
  // Simple vertex shader (same for both passes)
  const vertexShaderSource = `
        attribute vec2 position;
        attribute vec2 texCoord;
        varying vec2 vTexCoord;
        void main() {
          gl_Position = vec4(position, 0.0, 1.0);
          vTexCoord = texCoord;
        }
      `;
  // Pass-through fragment shader: simply sample the texture.
  const passThroughFragmentShaderSource = `
        precision mediump float;
        varying vec2 vTexCoord;
        uniform sampler2D uTexture;
        void main() {
          gl_FragColor = texture2D(uTexture, vTexCoord);
        }
      `;

  // Compile pass-through shaders and link program.
  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  if (!vertexShader) {
    console.error("Failed to create vertex shader");
    return;
  }
  gl.shaderSource(vertexShader, vertexShaderSource);
  gl.compileShader(vertexShader);
  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    console.error("Vertex shader error:", gl.getShaderInfoLog(vertexShader));
  }
  const passThroughFragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!passThroughFragmentShader) {
    console.error("Failed to create fragment shader");
    return;
  }
  gl.shaderSource(passThroughFragmentShader, passThroughFragmentShaderSource);
  gl.compileShader(passThroughFragmentShader);
  if (!gl.getShaderParameter(passThroughFragmentShader, gl.COMPILE_STATUS)) {
    console.error(
      "Pass-through fragment shader error:",
      gl.getShaderInfoLog(passThroughFragmentShader)
    );
  }
  const passThroughProgram = gl.createProgram();
  if (!passThroughProgram) {
    console.error("Failed to create program");
    return;
  }
  gl.attachShader(passThroughProgram, vertexShader);
  gl.attachShader(passThroughProgram, passThroughFragmentShader);
  gl.linkProgram(passThroughProgram);
  if (!gl.getProgramParameter(passThroughProgram, gl.LINK_STATUS)) {
    console.error(
      "Pass-through program linking error:",
      gl.getProgramInfoLog(passThroughProgram)
    );
    return;
  }
  gl.useProgram(passThroughProgram);

  // Create a full-screen quad.
  const vertices = new Float32Array([
    // x,   y,    u,   v
    -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1,
    1,
  ]);
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const FSIZE = vertices.BYTES_PER_ELEMENT;

  const positionLoc = gl.getAttribLocation(passThroughProgram, "position");
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, FSIZE * 4, 0);
  gl.enableVertexAttribArray(positionLoc);

  const texCoordLoc = gl.getAttribLocation(passThroughProgram, "texCoord");
  gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, FSIZE * 4, FSIZE * 2);
  gl.enableVertexAttribArray(texCoordLoc);

  // Bind the texture.
  const textureLoc = gl.getUniformLocation(passThroughProgram, "uTexture");
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(textureLoc, 0);

  // Draw the quad.
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.flush();

  // Read pixels from the current framebuffer (original image).
  const brightnessStatus = detectBrightness(gl, width, height);
  console.log("Brightness status:", brightnessStatus);
  setBrightnessStatus(brightnessStatus);

  // ======================================================
  // PASS 2: Render with Laplacian shader to detect blur.
  // ======================================================
  // Clear the GL buffer.
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Laplacian fragment shader.
  const laplacianFragmentShaderSource = `
        precision highp float;
        varying vec2 vTexCoord;
        uniform sampler2D uTexture;
        uniform vec2 resolution;
        
        void main() {
          vec2 onePixel = vec2(1.0) / resolution;
          // Convert texture sample to grayscale.
          float center = dot(texture2D(uTexture, vTexCoord).rgb, vec3(0.299, 0.587, 0.114));
          float up     = dot(texture2D(uTexture, vTexCoord + vec2(0.0, onePixel.y)).rgb, vec3(0.299, 0.587, 0.114));
          float down   = dot(texture2D(uTexture, vTexCoord - vec2(0.0, onePixel.y)).rgb, vec3(0.299, 0.587, 0.114));
          float left   = dot(texture2D(uTexture, vTexCoord - vec2(onePixel.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
          float right  = dot(texture2D(uTexture, vTexCoord + vec2(onePixel.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
          float laplacian = (up + down + left + right) - 4.0 * center;
          float edge = abs(laplacian);
          gl_FragColor = vec4(vec3(edge), 1.0);
        }
      `;
  // Compile Laplacian fragment shader.
  const laplacianFragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!laplacianFragmentShader) {
    console.error("Failed to create fragment shader");
    return;
  }
  gl.shaderSource(laplacianFragmentShader, laplacianFragmentShaderSource);
  gl.compileShader(laplacianFragmentShader);
  if (!gl.getShaderParameter(laplacianFragmentShader, gl.COMPILE_STATUS)) {
    console.error(
      "Laplacian fragment shader error:",
      gl.getShaderInfoLog(laplacianFragmentShader)
    );
  }
  // Create a new program using the same vertex shader and the Laplacian fragment shader.
  const laplacianProgram = gl.createProgram();
  if (!laplacianProgram) {
    console.error("Failed to create program");
    return;
  }
  gl.attachShader(laplacianProgram, vertexShader);
  gl.attachShader(laplacianProgram, laplacianFragmentShader);
  gl.linkProgram(laplacianProgram);
  if (!gl.getProgramParameter(laplacianProgram, gl.LINK_STATUS)) {
    console.error(
      "Laplacian program linking error:",
      gl.getProgramInfoLog(laplacianProgram)
    );
    return;
  }
  gl.useProgram(laplacianProgram);

  // (Re)bind the vertex buffer and attributes.
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  const posLocLap = gl.getAttribLocation(laplacianProgram, "position");
  gl.vertexAttribPointer(posLocLap, 2, gl.FLOAT, false, FSIZE * 4, 0);
  gl.enableVertexAttribArray(posLocLap);
  const texLocLap = gl.getAttribLocation(laplacianProgram, "texCoord");
  gl.vertexAttribPointer(texLocLap, 2, gl.FLOAT, false, FSIZE * 4, FSIZE * 2);
  gl.enableVertexAttribArray(texLocLap);

  // Set the resolution uniform.
  const resolutionLoc = gl.getUniformLocation(laplacianProgram, "resolution");
  gl.uniform2f(resolutionLoc, width, height);

  // Bind texture and set sampler uniform.
  const textureLocLap = gl.getUniformLocation(laplacianProgram, "uTexture");
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(textureLocLap, 0);

  // Draw the quad with Laplacian shader.
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.flush();

  // Evaluate blurriness by computing the variance of the edge intensities.
  const blurry = detectBlurrinessByVariance(gl, width, height);
  console.log("Is image blurry?", blurry ? "Yes" : "No");
  setIsBlurry(blurry);

  gl.endFrameEXP();

  console.log(asset.name)
  console.log('')
}

/**
 * Reads back the framebuffer and computes the variance of the edge intensities.
 * The variance is computed on the red channel (which represents edge intensity).
 * A low variance typically indicates a blurry image.
 */
function detectBlurrinessByVariance(
  gl: ExpoWebGLRenderingContext,
  width: number,
  height: number,
  threshold = 0.005
) {
  // Read back pixel data.
  const pixelBuffer = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuffer);

  const values = [];
  for (let i = 0; i < pixelBuffer.length; i += 4) {
    // Normalize the red channel value to [0, 1].
    values.push(pixelBuffer[i] / 255);
  }

  // Calculate mean.
  const sum = values.reduce((acc, val) => acc + val, 0);
  const mean = sum / values.length;

  // Calculate variance.
  const variance =
    values.reduce((acc, val) => acc + (val - mean) * (val - mean), 0) /
    values.length;

  console.log("Variance of Laplacian:", variance);
  return variance < threshold;
}

function detectBrightness(
  gl: ExpoWebGLRenderingContext,
  width: number,
  height: number
) {
  // Allocate a buffer for RGBA pixel data.
  const pixelBuffer = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuffer);

  let totalLuminance = 0;
  const numPixels = width * height;

  // Compute luminance for each pixel.
  for (let i = 0; i < pixelBuffer.length; i += 4) {
    const r = pixelBuffer[i]; // Red channel [0,255]
    const g = pixelBuffer[i + 1]; // Green channel
    const b = pixelBuffer[i + 2]; // Blue channel

    // Compute luminance using standard weights.
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    totalLuminance += luminance;
  }

  // Compute the average luminance (in 0-255 scale).
  const avgLuminance = totalLuminance / numPixels;
  console.log(
    "Average luminance (0-255 scale):",
    avgLuminance,
    totalLuminance,
    numPixels
  );

  // Use the new criteria: too dark if below 50, too light if above 200.
  if (avgLuminance < 50) {
    return "too dark";
  } else if (avgLuminance > 200) {
    return "too light";
  } else {
    return "normal";
  }
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gl: {
    //fixed width/height directly correlates to variance threshold
    width: 500,
    height: 500,
    position: "absolute",
    top: -1000,
    left: -1000,
  },
  infoText: {
    textAlign: "center",
    marginVertical: 10,
    fontSize: 18,
  },
});
