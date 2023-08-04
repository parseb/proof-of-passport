package com.tananaev.passportreader

import android.content.res.AssetManager

class RapidSnark {
    external fun prove(
        jAssetManager: AssetManager, 
        zkeyFile: String, 
        witnessFile: String, 
        proof: ByteArray, 
        publicInputs: ByteArray, 
        error: ByteArray
    ): Boolean

    companion object {
        init {
            System.loadLibrary("rapidsnark-wrapper")
        }
    }
}