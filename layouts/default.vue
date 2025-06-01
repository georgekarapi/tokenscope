<template>
    <div class="h-screen p-6">
        <div class="fixed top-0 left-0 w-full h-full bg-black -z-10">
            <!-- Blue blur flare background effects -->
            <div class="absolute inset-0 opacity-10">
                <div class="absolute top-0 left-1/4 w-96 h-96 bg-blue-500 rounded-full filter blur-3xl flare-float-1" />
                <div
                    class="absolute bottom-1/3 right-1/3 w-80 h-80 bg-blue-400 rounded-full filter blur-2xl flare-float-2"
                />
                <div
                    class="absolute top-2/3 left-1/2 w-64 h-64 bg-blue-600 rounded-full filter blur-xl flare-float-3"
                />
            </div>
        </div>
        <NuxtLink to="/" class="text-white text-2xl font-bold">coin<span class="text-blue-700">scope</span></NuxtLink>
        <slot />
    </div>
</template>

<style>
@keyframes float1 {
    0%,
    100% {
        transform: translate(0, 0) rotate(0deg);
    }
    33% {
        transform: translate(20px, -30px) rotate(120deg);
    }
    66% {
        transform: translate(-25px, 20px) rotate(240deg);
    }
}

@keyframes float2 {
    0%,
    100% {
        transform: translate(0, 0) rotate(0deg);
    }
    50% {
        transform: translate(-30px, -20px) rotate(180deg);
    }
}

@keyframes float3 {
    0%,
    100% {
        transform: translate(0, 0) rotate(0deg);
    }
    25% {
        transform: translate(15px, 25px) rotate(90deg);
    }
    75% {
        transform: translate(-20px, -15px) rotate(270deg);
    }
}

.flare-float-1 {
    animation: float1 20s ease-in-out infinite;
}

.flare-float-2 {
    animation: float2 25s ease-in-out infinite;
}

.flare-float-3 {
    animation: float3 30s ease-in-out infinite;
}
</style>
