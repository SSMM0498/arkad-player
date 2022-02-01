<template>
  <div class="replayer" ref="player" :style="playerStyle">
    <div ref="frame" :style="style" />
    <template v-if="Object.values(replayer).length">
      <Controller
        ref="controller"
        :replayer="replayer"
        :show-controller="showController"
        :auto-play="autoPlay"
        @fullscreen="toggleFullScreen"
        @ui-update-current-time="
          $emit('ui-update-current-time', $event.payload)
        "
        @ui-update-player-state="
          $emit('ui-update-player-state', $event.payload)
        "
      />
    </template>
  </div>
</template>
<script lang="ts">
import { Player } from "../../../core";
import type { eventWithTime } from "../../../core/PlayerDOM/types";
import {
  inlineCss,
  openFullscreen,
  exitFullscreen,
  isFullscreen,
  onFullscreenChange,
} from "../scripts/utils";
import Controller from "./ControllerBoard.vue";
import { PropType } from "vue";
export default {
  name: "RRWebPlayer",
  components: {
    Controller,
  },
  props: {
    width: {
      type: Number,
      required: false,
    },
    height: {
      type: Number,
      required: false,
    },
    events: {
      type: Array as PropType<eventWithTime[]>,
      default: () => [],
    },
    autoPlay: {
      type: Boolean,
      default: true,
    },
    showController: {
      type: Boolean,
      default: true,
    },
    tags: {
      type: Object as PropType<Record<string, string>>,
      default: () => ({}),
    },
  },
  data: () => ({
    _width: 0,
    _height: 0,
    controllerHeight: 80,
    replayer: {} as Player,
    fullscreenListener: () => {},
    controller: {} as typeof Controller,
    defaultWidth: 1024,
    defaultHeight: 576,
  }),

  computed: {
    style(): ReturnType<typeof inlineCss> {
      return inlineCss({
        width: `${this.computedWidth}px`,
        height: `${this.computedHeight}px`,
      });
    },
    playerStyle(): ReturnType<typeof inlineCss> {
      return inlineCss({
        width: `${this.computedWidth}px`,
        height: `${
          this.computedHeight +
          (this.showController ? this.controllerHeight : 0)
        }px`,
      });
    },
    player() {
      return this.$refs.player as HTMLElement;
    },
    controllerRef() {
      return this.$refs.controller as typeof Controller;
    },
    frame() {
      return this.$refs.frame as HTMLElement;
    },
    computedWidth: {
      get() {
        return this.width || this.defaultWidth;
      },
      set(value: number) {
        if (this.width) {
          this.$emit("update:width", value);
        } else {
          this.defaultWidth = value;
        }
      },
    },
    computedHeight: {
      get() {
        return this.height || this.defaultHeight;
      },
      set(value: number) {
        if (this.height) {
          this.$emit("update:height", value);
        } else {
          this.defaultHeight = value;
        }
      },
    },
    replayerInitialized() {
      return this.replayer instanceof Player;
    },
  },

  methods: {
    updateScale(
      el: HTMLElement,
      frameDimension: { width: number; height: number }
    ) {
      const widthScale = this.computedWidth / frameDimension.width;
      const heightScale = this.computedHeight / frameDimension.height;
      el.style.transform =
        `scale(${Math.min(widthScale, heightScale, 1)})`
        // + "translate(-50%, -50%)";
    },
    toggleFullScreen() {
      if (this.player) {
        isFullscreen() ? exitFullscreen() : openFullscreen(this.player);
      }
    },
  },
  mounted() {
    this.replayer = new Player(this.events, this.frame);
    this.$nextTick(() => {
      this.replayer.on(
        "resize",
        (dimension: { width: number; height: number }) => {
          this.updateScale(this.replayer.dom.wrapper, dimension);
        }
      );
    });
    this.fullscreenListener = onFullscreenChange(() => {
      if (isFullscreen()) {
        setTimeout(() => {
          this._width = this.computedWidth;
          this._height = this.computedHeight;
          this.computedWidth = this.player.offsetWidth;
          this.computedHeight = this.player.offsetHeight;
          this.updateScale(this.replayer.dom.wrapper, {
            width: this.replayer.iframe.offsetWidth,
            height: this.replayer.iframe.offsetHeight,
          });
        }, 0);
      } else {
        this.computedWidth = this._width;
        this.computedHeight = this._height;
        this.updateScale(this.replayer.dom.wrapper, {
          width: this.replayer.iframe.offsetWidth,
          height: this.replayer.iframe.offsetHeight,
        });
      }
    });
  },
  destroyed() {
    this.fullscreenListener && this.fullscreenListener();
  },
};
</script>
<style>
.replayer {
  position: relative;
  background: black;
  float: left;
  border-radius: 5px;
  box-shadow: 0 24px 48px rgba(17, 16, 62, 0.12);
}

.rr-player_frame {
  overflow: hidden;
}

.replayer-wrapper > iframe {
  border: none;
}

.replayer-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: black;
}

.replayer-iframe {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.replayer-iframe {
  border: none;
}
</style>
