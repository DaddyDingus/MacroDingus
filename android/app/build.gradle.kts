plugins {
    id("com.android.application")
}

val releaseKeystore = rootProject.file("macrotrack-release.jks")
val releasePasswordFile = rootProject.file(".signing-password")
require(releaseKeystore.isFile && releasePasswordFile.isFile) {
    "Missing permanent MacroTrack signing files; restore android/macrotrack-release.jks and android/.signing-password from backup."
}
val releasePassword = releasePasswordFile.readText().trim()

android {
    namespace = "net.daddysserver.macrotrack"
    compileSdk = 36

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        applicationId = "net.daddysserver.macrotrack"
        minSdk = 26
        targetSdk = 36
        versionCode = 11
        versionName = "1.10"
    }

    signingConfigs {
        create("release") {
            storeFile = releaseKeystore
            storePassword = releasePassword
            keyAlias = "macrotrack"
            keyPassword = releasePassword
        }
    }

    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }

    // One maintained icon source for the PWA and native launcher.
    val generatedIconDir = "build/generated/macrotrackIcon"
    sourceSets["main"].res.srcDir(generatedIconDir)
    val copyLauncherIcon by tasks.registering(Copy::class) {
        from("../../frontend/public/icons/icon-512.png")
        into("$generatedIconDir/drawable")
        rename { "macrotrack_icon.png" }
    }
    tasks.named("preBuild").configure { dependsOn(copyLauncherIcon) }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.12.4")
}
