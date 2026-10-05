import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing: tv/keystore.properties points at your own key (see README).
// It stays on your computer — never committed — and every update must be
// signed with the same key, or Android refuses to install it over the old app.
val keystoreProps = rootProject.file("keystore.properties").takeIf { it.exists() }?.let { file ->
    Properties().apply { file.inputStream().use { load(it) } }
}

android {
    namespace = "app.myfitnessplan.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.myfitnessplan.tv"
        // Android 6. Every Android TV still in use has a WebView new enough for
        // the web interface; older boxes are rare and would need a separate test.
        minSdk = 23
        targetSdk = 35
        // The TV app ships on its own schedule, separate from desktop releases.
        versionCode = 2
        versionName = "1.0.0"
    }

    signingConfigs {
        if (keystoreProps != null) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystoreProps != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
