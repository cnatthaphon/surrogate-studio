(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./task_recipe_registry.js"));
    return;
  }
  root.OSCTaskRecipeDefinitionsBuiltin = factory(root.OSCTaskRecipeRegistry);
})(typeof globalThis !== "undefined" ? globalThis : this, function (taskRecipeRegistry) {
  "use strict";

  if (!taskRecipeRegistry) {
    throw new Error("OSCTaskRecipeDefinitionsBuiltin requires OSCTaskRecipeRegistry.");
  }

  taskRecipeRegistry.registerRecipes([
    {
      id: "supervised_standard",
      label: "Standard Supervised",
      description: "Default fixed-shape supervised training path for regression, reconstruction, and classification heads.",
      family: "supervised",
      trainMode: "standard",
    },
    {
      id: "sequence_forecast",
      label: "Sequence Forecast",
      description: "Supervised sequence prediction with fixed-shape targets and sequence-aware inputs.",
      family: "supervised",
      trainMode: "standard",
      metadata: { sequence: true },
    },
    {
      id: "gan_phased",
      label: "GAN Phased",
      description: "Phased adversarial training using schedule/phase semantics from the graph and trainer config.",
      family: "gan",
      trainMode: "phased",
      supportsBrowserRuntime: true,
      supportsServerRuntime: true,
    },
    {
      id: "diffusion_denoise",
      label: "Diffusion Denoise",
      description: "Denoising and timestep-conditioned diffusion-style training using standard supervised losses.",
      family: "diffusion",
      trainMode: "standard",
    },
    {
      id: "detection_single_box",
      label: "Single-Box Detection",
      description: "Single-object detection with fixed-size bbox regression and classification heads.",
      family: "detection",
      trainMode: "standard",
      metadata: {
        taskType: "object_detection",
        targetLayout: "single_box",
        suggestedMetrics: ["bbox_mae", "class_accuracy", "iou_mean"],
      },
    },
    {
      id: "segmentation_mask",
      label: "Semantic Segmentation",
      description: "Pixel-wise binary or multi-class segmentation. Target is a flat mask with values 0-1 per pixel.",
      family: "segmentation",
      trainMode: "standard",
      metadata: {
        taskType: "semantic_segmentation",
        targetLayout: "pixel_mask",
        suggestedMetrics: ["mask_iou", "dice", "pixel_accuracy"],
      },
    },
  ], { makeDefault: true });

  return taskRecipeRegistry.listRecipes();
});
