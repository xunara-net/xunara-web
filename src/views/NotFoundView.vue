<script setup lang="ts"></script>

<template>
  <div class="card">
    <div class="empty" style="padding: 60px 20px">
      <div class="icon">🧭</div>
      <div class="title">页面不存在</div>
      <div class="desc">你访问的页面不存在或已被移动。</div>
      <div style="margin-top: 16px"><router-link class="btn primary" to="/dashboard">回到控制台首页</router-link></div>
    </div>
  </div>
</template>
