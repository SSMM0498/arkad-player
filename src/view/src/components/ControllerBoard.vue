<template>
  <div class="rr-controller" v-if="showController">
    <div class="rr-timeline">
      <span class="rr-timeline_time">{{ formatTimeLocal(currentTime) }}</span>
      <div
        class="rr-progress"
        ref="progress"
        @click="handleProgressClick"
      >
        <div
          class="rr-progress_step"
          ref="step"
          :style="{ width: percentage }"
        ></div>
        <div class="rr-progress_handler" :style="{ left: percentage }" ></div>
      </div>
      <span class="rr-timeline_time">{{
        formatTimeLocal(meta.totalTime)
      }}</span>
    </div>
    <div class="rr-controller_btns">
      <button @click="toggle">
        <template v-if="playerState === 'playing'">
          <svg
            class="icon"
            viewBox="0 0 1024 1024"
            version="1.1"
            xmlns="http://www.w3.org/2000/svg"
            xmlns:xlink="http://www.w3.org/1999/xlink"
            width="16"
            height="16"
          >
            <path
              d="M682.65984 128q53.00224 0 90.50112 37.49888t37.49888 90.50112l0
              512q0 53.00224-37.49888 90.50112t-90.50112
              37.49888-90.50112-37.49888-37.49888-90.50112l0-512q0-53.00224
              37.49888-90.50112t90.50112-37.49888zM341.34016 128q53.00224 0
              90.50112 37.49888t37.49888 90.50112l0 512q0 53.00224-37.49888
              90.50112t-90.50112
              37.49888-90.50112-37.49888-37.49888-90.50112l0-512q0-53.00224
              37.49888-90.50112t90.50112-37.49888zM341.34016 213.34016q-17.67424
              0-30.16704 12.4928t-12.4928 30.16704l0 512q0 17.67424 12.4928
              30.16704t30.16704 12.4928 30.16704-12.4928
              12.4928-30.16704l0-512q0-17.67424-12.4928-30.16704t-30.16704-12.4928zM682.65984
              213.34016q-17.67424 0-30.16704 12.4928t-12.4928 30.16704l0 512q0
              17.67424 12.4928 30.16704t30.16704 12.4928 30.16704-12.4928
              12.4928-30.16704l0-512q0-17.67424-12.4928-30.16704t-30.16704-12.4928z"
            />
          </svg>
        </template>
        <template v-else>
          <svg
            class="icon"
            viewBox="0 0 1024 1024"
            version="1.1"
            xmlns="http://www.w3.org/2000/svg"
            xmlns:xlink="http://www.w3.org/1999/xlink"
            width="16"
            height="16"
          >
            <path
              d="M170.65984 896l0-768 640 384zM644.66944
              512l-388.66944-233.32864 0 466.65728z"
            />
          </svg>
        </template>
      </button>
      <button @click="$emit('fullscreen')">
        <svg
          class="icon"
          viewBox="0 0 1024 1024"
          version="1.1"
          xmlns="http://www.w3.org/2000/svg"
          xmlns:xlink="http://www.w3.org/1999/xlink"
          width="16"
          height="16"
        >
          <path
            d="M916 380c-26.4 0-48-21.6-48-48L868 223.2 613.6 477.6c-18.4
            18.4-48.8 18.4-68 0-18.4-18.4-18.4-48.8 0-68L800 156 692 156c-26.4
            0-48-21.6-48-48 0-26.4 21.6-48 48-48l224 0c26.4 0 48 21.6 48 48l0
            224C964 358.4 942.4 380 916 380zM231.2 860l108.8 0c26.4 0 48 21.6 48
            48s-21.6 48-48 48l-224 0c-26.4 0-48-21.6-48-48l0-224c0-26.4 21.6-48
            48-48 26.4 0 48 21.6 48 48L164 792l253.6-253.6c18.4-18.4 48.8-18.4
            68 0 18.4 18.4 18.4 48.8 0 68L231.2 860z"
            p-id="1286"
          />
        </svg>
      </button>
    </div>
  </div>
</template>
<script lang="ts">
import { EventType, eventWithTime } from "../../../core/PlayerDOM/types";
import { Player } from "../../../core";
import { playerMetaData } from "../../../core/PlayerDOM/types";
import type { PlayerMachineState, PlayerState } from "../../../core/PlayerStateMachine/PlayerStateMachine";
import { formatTime } from "../scripts/utils";
import Vue, { PropType } from 'vue';

export default {
  name: 'RRWebPlayerController',
  props: {
    replayer: {
      type: Object as PropType<Player>,
      required: true,
    },
    autoPlay: {
      type: Boolean,
      required: true,
    },
    showController: {
      type: Boolean,
      default: true,
    },
  },
  data: () => ({
    currentTime: 0,
    timer: 0,
    playerState: 'playing' as 'playing' | 'paused' | 'live',
    finished: false,
    meta: {} as playerMetaData,
    percentage: '',
  }),
  computed: {
    progress() {
      return this.$refs.progress as Element;
    },
    step() {
      return this.$refs.step;
    },
  },
  methods: {
    formatTimeLocal(ms: number) {
      return formatTime(ms)
    },
    loopTimer() {
      this.stopTimer();

      const update = () => {
        this.currentTime = this.replayer.getCurrentTime();

        if (this.currentTime < this.meta.totalTime) {
          this.timer = requestAnimationFrame(update);
        }
      }

      this.timer = requestAnimationFrame(update);
    },
    stopTimer() {
      if (this.timer) {
        cancelAnimationFrame(this.timer);
        this.timer = 0;
      }
    },
    toggle() {
      switch (this.playerState) {
        case 'playing':
          this.pause();
          break;
        case 'paused':
          this.play();
          break;
        default:
          break;
      }
    },
    play() {
      if (this.playerState !== 'paused') {
        return;
      }
      if (this.finished) {
        this.replayer.play();
        this.finished = false;
      } else {
        this.replayer.play(this.currentTime);
      }
    },

    pause() {
      if (this.playerState !== 'playing') {
        return;
      }
      this.replayer.pause();
    },

    goto(timeOffset: number) {
      this.currentTime = timeOffset;
      const isPlaying = this.playerState === 'playing';
      this.replayer.pause();
      this.replayer.play(timeOffset);
      if (!isPlaying) {
        this.replayer.pause();
      }
    },

    handleProgressClick(event: MouseEvent) {
      if (!this.progress) return
      const progressRect = this.progress.getBoundingClientRect();
      const x = event.clientX - progressRect.left;
      let percent = x / progressRect.width;
      if (percent < 0) {
        percent = 0;
      } else if (percent > 1) {
        percent = 1;
      }
      const timeOffset = this.meta.totalTime * percent;
      this.goto(timeOffset);
    },
  },
  watch: {
    currentTime(value: Number) {
      this.$emit('ui-update-current-time', { payload: value });
      //
      const percent = Math.min(1, this.currentTime / this.meta.totalTime);
      this.percentage = `${100 * percent}%`;
      this.$emit('ui-update-progress', { payload: percent });
      //
    },
    playerState(value: PlayerState) {
      this.$emit('ui-update-player-state', { payload: value });
    }
  },
  mounted() {
    this.meta = this.replayer.getMetaData();
    this.playerState = this.replayer.playerSM.state.value;
    this.replayer.on(
      'state-change',
      // @ts-ignore
      (states: { player?: PlayerMachineState; }) => {
        const { player } = states;
        if (player?.value && this.playerState !== player.value) {
          this.playerState = player.value;
          switch (this.playerState) {
            case 'playing':
              this.loopTimer();
              break;
            case 'paused':
              this.stopTimer();
              break;
            default:
              break;
          }
        }
      },
    );
    this.replayer.on('finish', () => {
      this.finished = true;
    });

    if (this.autoPlay) {
      this.replayer.play();
    }
  },
  destroyed() {
    this.replayer.pause();
    this.stopTimer();
  }
};
</script>
<style>
  .rr-controller {
    position: absolute;
    bottom: 0%;
    width: 100%;
    height: 80px;
    background: #fff;
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    align-items: center;
    border-radius: 0 0 5px 5px;
  }

  .rr-timeline {
    width: 80%;
    display: flex;
    align-items: center;
  }

  .rr-timeline_time {
    display: inline-block;
    width: 100px;
    text-align: center;
    color: #11103e;
  }

  .rr-progress {
    flex: 1;
    height: 12px;
    background: #eee;
    position: relative;
    border-radius: 3px;
    cursor: pointer;
    box-sizing: border-box;
    border-top: solid 4px #fff;
    border-bottom: solid 4px #fff;
  }

  .rr-progress.disabled {
    cursor: not-allowed;
  }

  .rr-progress_step {
    height: 100%;
    position: absolute;
    left: 0;
    top: 0;
    background: #e0e1fe;
  }

  .rr-progress_handler {
    width: 20px;
    height: 20px;
    border-radius: 10px;
    position: absolute;
    top: 2px;
    transform: translate(-50%, -50%);
    background: rgb(73, 80, 246);
  }

  .rr-controller_btns {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
  }

  .rr-controller_btns button {
    width: 32px;
    height: 32px;
    display: flex;
    padding: 0;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .rr-controller_btns button:active {
    background: #e0e1fe;
  }

  .rr-controller_btns button.active {
    color: #fff;
    background: rgb(73, 80, 246);
  }

  .rr-controller_btns button:disabled {
    cursor: not-allowed;
  }
</style>
