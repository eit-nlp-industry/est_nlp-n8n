<script setup lang="ts">
import { elementPlusRegistry } from '@eit/json-render-element-plus';
import type { JsonRenderPayload } from '@eit/json-render-protocol';
import { JsonRenderPanel } from '@eit/json-render-vue';

const props = defineProps<{
	payload: Record<string, unknown>;
}>();
</script>

<template>
	<div class="chat-json-render">
		<JsonRenderPanel
			:payload="props.payload as JsonRenderPayload"
			instance-id="chat-widget-json-render"
			:registry="elementPlusRegistry"
		/>
	</div>
</template>

<style scoped>
.chat-json-render {
	display: block;
	width: max-content;
	max-width: 100%;
	min-width: min(100%, 20rem);
	color: #1f2937;
	background: #fff;
}

.chat-json-render :deep(.json-render-panel) {
	width: 100%;
}

.chat-json-render :deep(.json-render-error) {
	color: #1f2937;
	font-size: 0.875rem;
}

/* Hosted chat does not load Element Plus theme CSS — provide dashboard chrome inline. */
.chat-json-render :deep(.json-render-card) {
	border: 1px solid #dcdfe6;
	border-radius: 8px;
	background: #fff;
	overflow: hidden;
}

.chat-json-render :deep(.el-card__header) {
	border-bottom: 1px solid #ebeef5;
}

.chat-json-render :deep(.json-render-metric) {
	flex: 1 1 8rem;
	padding: 12px;
	border: 1px solid #ebeef5;
	border-radius: 8px;
	background: #fafafa;
}

.chat-json-render :deep(.el-table) {
	--el-table-border-color: #ebeef5;
	--el-table-header-bg-color: #f5f7fa;
	--el-table-text-color: #1f2937;
	--el-table-header-text-color: #606266;
}

.chat-json-render :deep(.el-table__inner-wrapper) {
	border: 1px solid #ebeef5;
	border-radius: 8px;
	overflow: hidden;
}
</style>
